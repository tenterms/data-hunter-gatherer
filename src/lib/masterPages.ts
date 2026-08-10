import Anthropic from "@anthropic-ai/sdk";
import { getAppConfig } from "./config";
import { loadAdminConfig } from "./sheets";
import { replaceRowsAnywhere, cell } from "./rowStore";
import { fetchPageContent, fetchTextThroughChallenges } from "@/reactimus/content/fetcher";
import type { MasterPageRow } from "./types";
import type { ActionResult } from "./adminActions";

/**
 * The master page list: one shared inventory of a client's site used by both
 * the reports and Reactimus. Built by scanning the site's sitemap, fetching
 * each page's title/H1, and asking Claude to infer the primary keyword each
 * page is targeting. The team then corrects keywords and organises pages into
 * "section of site" and "close group" — the close groups double as natural
 * internal-linking neighbourhoods.
 */

const MAX_PAGES = 250;
const FETCH_CONCURRENCY = 4;

const normUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Sitemap discovery
// ---------------------------------------------------------------------------

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
}

// Sitemaps sit behind the same bot walls as pages (AAG's SiteGround gate
// challenges sitemap.xml too), so they go through the challenge-aware fetch.
const fetchText = (url: string) => fetchTextThroughChallenges(url, 15000);

// Skip obvious non-content URLs so we don't burn the page budget on them.
const SKIP_PATTERNS =
  /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|webm|css|js|xml)(\?|$)|\/(tag|author|feed|wp-content|wp-json|cart|checkout|my-account)\//i;

export interface DiscoveredUrl {
  url: string;
  /** Basename of the sitemap it came from, e.g. "page-sitemap.xml". */
  source: string;
}

/**
 * Priority for the fetch budget. Commercial-looking sources first: on
 * WordPress sites the blog often sits at the root while services live in
 * folders, so relying on URL shape alone buries the pages that matter.
 * Every child sitemap is read in full BEFORE the budget applies, so page
 * and service sitemaps always beat a large blog into the list.
 */
function sourcePriority(source: string, url: string): number {
  const s = source.toLowerCase();
  if (/(^|\/)(page|service|product|local|portfolio|location)[-_]?sitemap/.test(s)) return 0;
  if (/post[-_]?sitemap|blog/.test(s)) return 2;
  if (/category|archive/.test(s)) return 3;
  // Unknown sitemap: guess from the URL — blog-ish paths later.
  if (/\/(blog|news|insights|knowledge|resources|articles|case-stud)/i.test(url)) return 2;
  return 1;
}

/** Discover a site's page URLs from its sitemap(s); robots.txt as a pointer. */
export async function discoverSiteUrls(domain: string, log: (m: string) => void): Promise<DiscoveredUrl[]> {
  const base = `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const candidates = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`];

  const robots = await fetchText(`${base}/robots.txt`);
  for (const m of robots.matchAll(/^sitemap:\s*(\S+)/gim)) candidates.unshift(m[1]!);

  const seenSitemaps = new Set<string>();
  const found = new Map<string, DiscoveredUrl>();
  const queue = [...new Set(candidates)];

  // Read every sitemap fully first; the page budget is applied AFTER
  // prioritisation so commercial pages are never crowded out by blog posts.
  while (queue.length > 0 && found.size < 3000) {
    const sitemapUrl = queue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    const xml = await fetchText(sitemapUrl);
    if (!xml) continue;
    const locs = extractLocs(xml);
    if (locs.length === 0) continue;
    const source = (() => {
      try {
        return new URL(sitemapUrl).pathname.split("/").filter(Boolean).pop() ?? sitemapUrl;
      } catch {
        return sitemapUrl;
      }
    })();
    if (/<sitemapindex/i.test(xml)) {
      log(`Sitemap index found: ${sitemapUrl} (${locs.length} child sitemaps).`);
      queue.push(...locs.slice(0, 40));
    } else {
      log(`Sitemap read: ${sitemapUrl} (${locs.length} URLs).`);
      for (const loc of locs) {
        try {
          const u = new URL(loc);
          if (u.host.replace(/^www\./, "") !== new URL(base).host.replace(/^www\./, "")) continue;
          if (SKIP_PATTERNS.test(loc)) continue;
          if (!found.has(loc)) found.set(loc, { url: loc, source });
        } catch {
          // ignore malformed loc entries
        }
      }
    }
  }

  const all = [...found.values()].sort(
    (a, b) => sourcePriority(a.source, a.url) - sourcePriority(b.source, b.url) || a.url.localeCompare(b.url),
  );
  if (all.length > MAX_PAGES) {
    log(`${all.length} URLs found — keeping the ${MAX_PAGES} highest-priority (commercial pages first, blog posts fill the rest).`);
  }
  return all.slice(0, MAX_PAGES);
}

// ---------------------------------------------------------------------------
// Primary keyword inference
// ---------------------------------------------------------------------------

/** Fallback: derive a keyword from the H1/title without an LLM. */
function keywordFromTitle(title: string, h1: string): string {
  const source = h1 || title.split(/[|·–-]{1,2}/)[0] || "";
  return source.replace(/\s+/g, " ").trim().toLowerCase();
}

export type PageIntentGuess = "commercial" | "informational" | "other";

/** Fallback intent guess from the sitemap source, URL shape and title. */
export function guessIntent(url: string, source: string, title: string): PageIntentGuess {
  const s = source.toLowerCase();
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/post[-_]?sitemap|category|archive/.test(s)) return "informational";
  if (/\/(blog|news|insights|knowledge|resources|articles|guides|case-stud|events?)\//.test(path)) return "informational";
  if (/\/(contact|about|privacy|cookie|terms|careers|team|legal|sitemap)/.test(path)) return "other";
  if (/(^|\/)(page|service|product|local|location)[-_]?sitemap/.test(s)) return "commercial";
  if (/\/(services?|products?|solutions|pricing|industries|sectors)\//.test(path)) return "commercial";
  if (/\b(how|why|what|when|guide|tips|vs\.?|explained)\b/i.test(title)) return "informational";
  return path === "/" ? "commercial" : "informational";
}

interface PageAssignment {
  primary_keyword: string;
  intent: PageIntentGuess;
}

async function assignKeywordsAndIntent(
  pages: Array<{ url: string; title: string; h1: string; source: string }>,
  clientName: string,
  log: (m: string) => void,
): Promise<Map<string, PageAssignment>> {
  const out = new Map<string, PageAssignment>();
  const fallback = (p: (typeof pages)[number]): PageAssignment => ({
    primary_keyword: keywordFromTitle(p.title, p.h1),
    intent: guessIntent(p.url, p.source, p.title),
  });

  const app = getAppConfig();
  if (!app.anthropicApiKey) {
    log("No Anthropic key configured — using title/H1 words and URL shape as the keyword and intent guess.");
    for (const p of pages) out.set(normUrl(p.url), fallback(p));
    return out;
  }

  const client = new Anthropic({ apiKey: app.anthropicApiKey });
  const chunks: Array<typeof pages> = [];
  for (let i = 0; i < pages.length; i += 40) chunks.push(pages.slice(i, i + 40));

  for (const chunk of chunks) {
    const listing = chunk
      .map((p, i) => `${i + 1}. URL: ${p.url}\n   Title: ${p.title || "(none)"}\n   H1: ${p.h1 || "(none)"}`)
      .join("\n");
    try {
      const response = await client.beta.messages.create({
        model: app.anthropicModel,
        max_tokens: 6000,
        system: [
          "You assign the primary target keyword and intent to pages of a business website, based on each page's URL, title tag and H1.",
          "The primary keyword is the single search phrase the page most plausibly targets: a short, natural phrase a customer would type (e.g. \"it support sheffield\", \"penetration testing services\").",
          `Never use the business's own brand name ("${clientName}") as or inside a keyword — strip it. For pages with no meaningful search target (contact, privacy policy, plain blog index), use a short literal description like "contact page" or "blog index".`,
          "Lowercase. No punctuation. 2 to 5 words. One keyword per page.",
          "Intent, judged mainly from the title: \"commercial\" for pages selling or describing a service/product/sector offering (someone searching this is a potential buyer); \"informational\" for blog posts, guides, news and explainers; \"other\" for contact, about, legal and housekeeping pages.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: `Assign a primary keyword and intent to each of these ${chunk.length} pages:\n\n${listing}`,
          },
        ],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                keywords: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "integer" },
                      primary_keyword: { type: "string" },
                      intent: { type: "string", enum: ["commercial", "informational", "other"] },
                    },
                    required: ["index", "primary_keyword", "intent"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["keywords"],
              additionalProperties: false,
            },
          },
        },
      });
      if (response.stop_reason === "refusal") throw new Error("model refused");
      const text = response.content.find((b) => b.type === "text");
      const parsed = JSON.parse(text && text.type === "text" ? text.text : "{}") as {
        keywords?: Array<{ index: number; primary_keyword: string; intent: PageIntentGuess }>;
      };
      for (const k of parsed.keywords ?? []) {
        const page = chunk[k.index - 1];
        if (page) {
          out.set(normUrl(page.url), {
            primary_keyword: k.primary_keyword.trim().toLowerCase(),
            intent: k.intent,
          });
        }
      }
      for (const p of chunk) {
        if (!out.has(normUrl(p.url))) out.set(normUrl(p.url), fallback(p));
      }
    } catch (err) {
      log(`Keyword assignment fell back to title words for ${chunk.length} page(s): ${(err as Error).message}`);
      for (const p of chunk) out.set(normUrl(p.url), fallback(p));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section guess from URL structure
// ---------------------------------------------------------------------------

function sectionFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length === 0) return "Home";
    if (parts.length === 1) return "Top level";
    return parts[0]!
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Scan + save
// ---------------------------------------------------------------------------

export async function scanMasterPages(
  clientKey: string,
  logFn?: (m: string) => void,
): Promise<ActionResult & { rows?: MasterPageRow[] }> {
  const log = logFn ?? (() => {});
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return { ok: false, message: "Unknown client." };

  log(`Scanning ${client.domain} for pages …`);
  const discovered = await discoverSiteUrls(client.domain, log);
  if (discovered.length === 0) {
    return { ok: false, message: `No sitemap found at ${client.domain} — a master list can't be built automatically.` };
  }
  log(`Fetching ${discovered.length} page(s) for titles and H1s …`);

  const fetched: Array<{ url: string; source: string; title: string; h1: string; status: number }> = [];
  for (let i = 0; i < discovered.length; i += FETCH_CONCURRENCY) {
    const batch = discovered.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ url, source }) => {
        const page = await fetchPageContent(url, 15000, log);
        return { url, source, title: page.titleTag, h1: page.h1, status: page.httpStatus };
      }),
    );
    fetched.push(...results);
    if ((i + FETCH_CONCURRENCY) % 40 < FETCH_CONCURRENCY) log(`… ${Math.min(i + FETCH_CONCURRENCY, discovered.length)} of ${discovered.length} fetched.`);
  }
  const readable = fetched.filter((f) => f.status === 200 && (f.title || f.h1));
  log(`${readable.length} of ${fetched.length} pages readable; asking Claude for primary keywords and intent …`);

  const assignments = await assignKeywordsAndIntent(readable, client.client_name, log);

  // Existing rows keep every human-edited field; the scan only refreshes
  // title/H1 and adds pages it hasn't seen before.
  const existing = new Map(
    config.masterPages.filter((p) => p.client_key === clientKey).map((p) => [normUrl(p.url), p]),
  );
  const rows: MasterPageRow[] = readable.map((f) => {
    const prior = existing.get(normUrl(f.url));
    const assigned = assignments.get(normUrl(f.url));
    return {
      client_key: clientKey,
      url: f.url,
      title: f.title,
      h1: f.h1,
      primary_keyword: prior?.primary_keyword || assigned?.primary_keyword || keywordFromTitle(f.title, f.h1),
      intent: prior?.intent || assigned?.intent || guessIntent(f.url, f.source, f.title),
      section: prior?.section || sectionFromUrl(f.url),
      close_group: prior?.close_group || "",
      active: prior ? prior.active : true,
      notes: prior?.notes ?? "",
    };
  });
  // Pages that vanished from the sitemap but were curated stay in the list.
  for (const [key, prior] of existing) {
    if (!rows.some((r) => normUrl(r.url) === key)) rows.push(prior);
  }

  await replaceRowsAnywhere("MasterPages", (r) => cell(r.client_key) === clientKey, rows as unknown as Array<Record<string, unknown>>);
  log(`Master list saved: ${rows.length} page(s).`);
  return { ok: true, message: `Master list built: ${rows.length} pages.`, rows };
}

/** Save edited rows (primary keyword / intent / section / close group / active). */
export async function saveMasterPages(
  clientKey: string,
  edits: Array<Pick<MasterPageRow, "url" | "primary_keyword" | "intent" | "section" | "close_group" | "active">>,
): Promise<ActionResult> {
  const { config } = await loadAdminConfig();
  const current = config.masterPages.filter((p) => p.client_key === clientKey);
  if (current.length === 0) return { ok: false, message: "No master list yet — run a scan first." };

  const editByUrl = new Map(edits.map((e) => [normUrl(e.url), e]));
  const rows = current.map((row) => {
    const edit = editByUrl.get(normUrl(row.url));
    if (!edit) return row;
    return {
      ...row,
      primary_keyword: edit.primary_keyword.trim(),
      intent: ["commercial", "informational", "other"].includes(edit.intent) ? edit.intent : row.intent,
      section: edit.section.trim(),
      close_group: edit.close_group.trim(),
      active: edit.active,
    };
  });
  await replaceRowsAnywhere("MasterPages", (r) => cell(r.client_key) === clientKey, rows as unknown as Array<Record<string, unknown>>);
  return { ok: true, message: "Master list saved." };
}
