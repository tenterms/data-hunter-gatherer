import Anthropic from "@anthropic-ai/sdk";
import { getAppConfig } from "./config";
import { loadAdminConfig } from "./sheets";
import { replaceRowsAnywhere, cell } from "./rowStore";
import { fetchPageContent } from "@/reactimus/content/fetcher";
import { proxyAwareFetch } from "@/reactimus/content/httpClient";
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

const MAX_PAGES = 150;
const FETCH_CONCURRENCY = 4;

const normUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Sitemap discovery
// ---------------------------------------------------------------------------

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
}

async function fetchText(url: string): Promise<string> {
  try {
    const res = await proxyAwareFetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/xml,text/xml,text/plain,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  }
}

// Skip obvious non-content URLs so we don't burn the page budget on them.
const SKIP_PATTERNS =
  /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|webm|css|js|xml)(\?|$)|\/(tag|author|feed|wp-content|wp-json|cart|checkout|my-account)\//i;

/** Discover a site's page URLs from its sitemap(s); robots.txt as a pointer. */
export async function discoverSiteUrls(domain: string, log: (m: string) => void): Promise<string[]> {
  const base = `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  const candidates = [`${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/wp-sitemap.xml`];

  const robots = await fetchText(`${base}/robots.txt`);
  for (const m of robots.matchAll(/^sitemap:\s*(\S+)/gim)) candidates.unshift(m[1]!);

  const seenSitemaps = new Set<string>();
  const urls = new Set<string>();
  const queue = [...new Set(candidates)];

  while (queue.length > 0 && urls.size < MAX_PAGES * 2) {
    const sitemapUrl = queue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    const xml = await fetchText(sitemapUrl);
    if (!xml) continue;
    const locs = extractLocs(xml);
    if (locs.length === 0) continue;
    if (/<sitemapindex/i.test(xml)) {
      log(`Sitemap index found: ${sitemapUrl} (${locs.length} child sitemaps).`);
      queue.push(...locs.slice(0, 25));
    } else {
      log(`Sitemap read: ${sitemapUrl} (${locs.length} URLs).`);
      for (const loc of locs) {
        try {
          const u = new URL(loc);
          if (u.host.replace(/^www\./, "") !== new URL(base).host.replace(/^www\./, "")) continue;
          if (SKIP_PATTERNS.test(loc)) continue;
          urls.add(loc);
        } catch {
          // ignore malformed loc entries
        }
      }
    }
  }
  return [...urls].slice(0, MAX_PAGES);
}

// ---------------------------------------------------------------------------
// Primary keyword inference
// ---------------------------------------------------------------------------

/** Fallback: derive a keyword from the H1/title without an LLM. */
function keywordFromTitle(title: string, h1: string): string {
  const source = h1 || title.split(/[|·–-]{1,2}/)[0] || "";
  return source.replace(/\s+/g, " ").trim().toLowerCase();
}

async function assignPrimaryKeywords(
  pages: Array<{ url: string; title: string; h1: string }>,
  clientName: string,
  log: (m: string) => void,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const app = getAppConfig();
  if (!app.anthropicApiKey) {
    log("No Anthropic key configured — using title/H1 words as the primary keyword guess.");
    for (const p of pages) out.set(normUrl(p.url), keywordFromTitle(p.title, p.h1));
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
        max_tokens: 4000,
        system: [
          "You assign the primary target keyword to pages of a business website, based on each page's URL, title tag and H1.",
          "The primary keyword is the single search phrase the page most plausibly targets: a short, natural phrase a customer would type (e.g. \"it support sheffield\", \"penetration testing services\").",
          `Never use the business's own brand name ("${clientName}") as or inside a keyword — strip it. For pages with no meaningful search target (contact, privacy policy, plain blog index), use a short literal description like "contact page" or "blog index".`,
          "Lowercase. No punctuation. 2 to 5 words. One keyword per page.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: `Assign a primary keyword to each of these ${chunk.length} pages:\n\n${listing}`,
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
                    },
                    required: ["index", "primary_keyword"],
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
        keywords?: Array<{ index: number; primary_keyword: string }>;
      };
      for (const k of parsed.keywords ?? []) {
        const page = chunk[k.index - 1];
        if (page) out.set(normUrl(page.url), k.primary_keyword.trim().toLowerCase());
      }
    } catch (err) {
      log(`Keyword assignment fell back to title words for ${chunk.length} page(s): ${(err as Error).message}`);
      for (const p of chunk) out.set(normUrl(p.url), keywordFromTitle(p.title, p.h1));
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
  const urls = await discoverSiteUrls(client.domain, log);
  if (urls.length === 0) {
    return { ok: false, message: `No sitemap found at ${client.domain} — a master list can't be built automatically.` };
  }
  log(`Fetching ${urls.length} page(s) for titles and H1s …`);

  const fetched: Array<{ url: string; title: string; h1: string; status: number }> = [];
  for (let i = 0; i < urls.length; i += FETCH_CONCURRENCY) {
    const batch = urls.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (url) => {
        const page = await fetchPageContent(url, 15000, log);
        return { url, title: page.titleTag, h1: page.h1, status: page.httpStatus };
      }),
    );
    fetched.push(...results);
    if ((i + FETCH_CONCURRENCY) % 40 < FETCH_CONCURRENCY) log(`… ${Math.min(i + FETCH_CONCURRENCY, urls.length)} of ${urls.length} fetched.`);
  }
  const readable = fetched.filter((f) => f.status === 200 && (f.title || f.h1));
  log(`${readable.length} of ${fetched.length} pages readable; asking Claude for primary keywords …`);

  const keywords = await assignPrimaryKeywords(readable, client.client_name, log);

  // Existing rows keep every human-edited field; the scan only refreshes
  // title/H1 and adds pages it hasn't seen before.
  const existing = new Map(
    config.masterPages.filter((p) => p.client_key === clientKey).map((p) => [normUrl(p.url), p]),
  );
  const rows: MasterPageRow[] = readable.map((f) => {
    const prior = existing.get(normUrl(f.url));
    return {
      client_key: clientKey,
      url: f.url,
      title: f.title,
      h1: f.h1,
      primary_keyword: prior?.primary_keyword || keywords.get(normUrl(f.url)) || keywordFromTitle(f.title, f.h1),
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

/** Save edited rows (primary keyword / section / close group / active). */
export async function saveMasterPages(
  clientKey: string,
  edits: Array<Pick<MasterPageRow, "url" | "primary_keyword" | "section" | "close_group" | "active">>,
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
      section: edit.section.trim(),
      close_group: edit.close_group.trim(),
      active: edit.active,
    };
  });
  await replaceRowsAnywhere("MasterPages", (r) => cell(r.client_key) === clientKey, rows as unknown as Array<Record<string, unknown>>);
  return { ok: true, message: "Master list saved." };
}
