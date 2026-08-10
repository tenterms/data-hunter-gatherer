import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { DATA_DIR, getAppConfig, REPORTS_DIR } from "./config";
import { getGoogleAuth, loadAdminConfig } from "./sheets";
import { resolveGscSiteUrl } from "./gsc";
import { appendRowsAnywhere } from "./rowStore";
import { readSnapshot } from "./snapshots";
import {
  draftBeforeAfters,
  heuristicBeforeAfter,
  pickAnchorSentence,
  contentTokens as draftTokens,
  type DraftableAction,
} from "./reactimusDraft";
import type { ActionResult } from "./adminActions";
import type { MasterPageRow, ReportSnapshot, StrategicNoteRow } from "./types";

import { DEFAULT_CONFIG } from "@/reactimus/config/defaults";
import { groupQueries } from "@/reactimus/grouping/grouper";
import { mergeCommercialSynonyms } from "@/reactimus/grouping/synonyms";
import { detectMention } from "@/reactimus/mentions/detector";
import { scoreGroup } from "@/reactimus/scoring/heuristics";
import { analyseGroup } from "@/reactimus/classify/decisionRules";
import { buildNewPageIdea } from "@/reactimus/recommendations/generator";
import { consolidateNewPageGroups } from "@/reactimus/recommendations/consolidate";
import { compileRules } from "@/reactimus/rules/engine";
import { fetchPageContent } from "@/reactimus/content/fetcher";
import type {
  AnalysedGroup,
  GscRawRow,
  MentionResult,
  PageContentRow,
  PageRow,
  ToolConfig,
} from "@/reactimus/types";

/**
 * Reactimus inside the reporting app: turns live GSC data into precise
 * before/after page edits, internal-link suggestions, cross-page tasks and
 * new-page ideas — one action row per keyword group, mirroring the team's
 * manual edit tracker. Site awareness comes from the client's master page
 * list (shared with the reports), so suggestions respect which page owns
 * which keyword and which pages are close internal-link partners.
 */

export const REACTIMUS_DIR = path.join(DATA_DIR, "reactimus");
const MAX_PAGES_PER_RUN = 15;
const SNAPSHOT_VERSION = 2;

export type ReactimusActionType = "H2 edit" | "Copy edit" | "FAQ" | "Internal link" | "New page" | "Task";
export type ReactimusStatus = "ready_to_review" | "approved" | "not_approved" | "implemented";

/** One row of the Reactimus results table (one keyword group, one action). */
export interface ReactimusAction {
  key: string;
  /** Page the row is filed under (differs from sourceUrl for cross-page tasks). */
  pageUrl: string;
  /** Page whose search data produced the row. */
  sourceUrl: string;
  keyword: string;
  variants: string;
  action: ReactimusActionType;
  /** Short taxonomy label, e.g. "Commercial keyword". */
  rationale: string;
  why: string;
  /** Verbatim text currently on the page ('' = new addition). */
  before: string;
  after: string;
  /** Link destination (internal links) or related page (tasks). */
  targetUrl: string;
  clicks: number;
  impressions: number;
  confidence: number;
  status: ReactimusStatus;
}

/** A ruled-out suggestion: suppressed on every future run until restored. */
export interface ArchivedSuggestion {
  archivedAt: string;
  kind: string;
  title: string;
  detail: string;
}

export interface ReactimusSnapshot {
  version: number;
  clientKey: string;
  clientName: string;
  generatedAt: string;
  window: { start: string; end: string };
  property: string;
  llm: string;
  pagesAnalysed: Array<{ url: string; status: string; queries: number; analysedAt?: string }>;
  actions: ReactimusAction[];
  rejectedCount: number;
  /** action key -> period_key it was added to the report for */
  added: Record<string, string>;
  /** action key -> archive entry; carried across runs so a ruled-out
   * suggestion never has to be ruled out again */
  archived: Record<string, ArchivedSuggestion>;
}

const normUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");

export const actionKey = (a: Pick<ReactimusAction, "pageUrl" | "action" | "keyword">) =>
  `act##${normUrl(a.pageUrl)}##${a.action}##${a.keyword.trim().toLowerCase()}`;

// Generic words that carry no brand meaning on their own, so a query made up
// only of these plus the client's distinctive name is "just the brand".
const GENERIC_BRAND_WORDS = new Set([
  "it", "services", "service", "ltd", "limited", "group", "uk", "the", "and",
  "co", "company", "inc", "solutions", "solution", "agency", "consulting",
  "consultancy", "partners", "systems", "technologies", "technology",
]);

function brandTokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !GENERIC_BRAND_WORDS.has(t));
}

/**
 * Build a test for whether a query is essentially the client's own brand name
 * (e.g. "aag it services" for client "AAG IT Services"). Such queries must
 * never become "new page" ideas: a business does not need a new page about
 * its own name.
 */
function brandQueryTest(clientName: string): (query: string) => boolean {
  const brandTokens = new Set(brandTokensOf(clientName));
  return (query: string) => {
    const tokens = brandTokensOf(query);
    if (tokens.length === 0 || brandTokens.size === 0) return false;
    return tokens.every((t) => brandTokens.has(t));
  };
}

function snapshotFile(clientKey: string): string {
  return path.join(REACTIMUS_DIR, `${clientKey}.json`);
}

export function readReactimusSnapshot(clientKey: string): ReactimusSnapshot | null {
  if (!/^[a-z0-9_-]+$/i.test(clientKey)) return null;
  const file = snapshotFile(clientKey);
  if (!fs.existsSync(file)) return null;
  try {
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8")) as ReactimusSnapshot;
    // Older snapshot formats are deliberately discarded: the action-row
    // format started from scratch, per the team's request.
    if (snapshot.version !== SNAPSHOT_VERSION) return null;
    snapshot.added ??= {};
    snapshot.archived ??= {};
    return snapshot;
  } catch {
    return null;
  }
}

function writeReactimusSnapshot(snapshot: ReactimusSnapshot): void {
  fs.mkdirSync(REACTIMUS_DIR, { recursive: true });
  fs.writeFileSync(snapshotFile(snapshot.clientKey), JSON.stringify(snapshot, null, 2));
}

/** Pull per-query GSC metrics for one page URL (last `monthsBack` months). */
async function queriesForUrl(
  config: ToolConfig,
  url: string,
): Promise<{ rows: GscRawRow[]; error?: string }> {
  const api = google.searchconsole({ version: "v1", auth: getGoogleAuth() as never });
  const end = new Date();
  end.setDate(end.getDate() - 2); // GSC data lags ~2 days
  const start = new Date(end);
  start.setMonth(start.getMonth() - (config.monthsBack || 3));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(start);
  const endDate = fmt(end);

  try {
    const res = await api.searchanalytics.query({
      siteUrl: config.gscProperty,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["query"],
        dimensionFilterGroups: [
          { filters: [{ dimension: "page", operator: "equals", expression: url }] },
        ],
        rowLimit: config.maxRawQueriesPerUrl,
      },
    });
    const pulledAt = new Date().toISOString();
    const rows: GscRawRow[] = (res.data.rows ?? [])
      .filter(
        (r) => (r.impressions ?? 0) >= config.minImpressions && (r.clicks ?? 0) >= config.minClicks,
      )
      .map((r) => ({
        url,
        query: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: Math.round((r.ctr ?? 0) * 10000) / 10000,
        avgPosition: Math.round((r.position ?? 0) * 100) / 100,
        startDate,
        endDate,
        pulledAt,
      }))
      .filter((r) => r.query !== "");
    return { rows };
  } catch (err) {
    return { rows: [], error: (err as Error).message };
  }
}

const INTENT_ORDER: Record<string, number> = { commercial: 0, informational: 1, other: 2 };

/** The set of pages Reactimus can run on: master list first, key pages as fallback. */
export async function reactimusPages(clientKey: string): Promise<Array<{ url: string; label: string; role: string }>> {
  const { config } = await loadAdminConfig();
  const master = config.masterPages.filter((p) => p.client_key === clientKey && p.active);
  if (master.length > 0) {
    // Commercial pages first — they're the ones the team runs most.
    return [...master]
      .sort(
        (a, b) =>
          (INTENT_ORDER[a.intent] ?? 1) - (INTENT_ORDER[b.intent] ?? 1) ||
          a.section.localeCompare(b.section) ||
          a.url.localeCompare(b.url),
      )
      .map((p) => ({
        url: p.url,
        label: p.primary_keyword || p.title || p.url,
        role: [p.intent, p.section].filter(Boolean).join(" · "),
      }));
  }
  const roleOrder: Record<string, number> = { primary: 0, secondary: 1, supporting: 2, rest_of_site: 3 };
  return config.clientPages
    .filter((p) => p.client_key === clientKey && p.active)
    .sort((a, b) => (roleOrder[a.page_role] ?? 9) - (roleOrder[b.page_role] ?? 9))
    .map((p) => ({ url: p.url, label: p.label, role: p.page_role }));
}

const RATIONALE_COMMERCIAL = "Commercial keyword";
const RATIONALE_PHRASE = "More relevant phrase";
const RATIONALE_QUESTION = "Customer question";
const RATIONALE_LINK = "Relevant link to commercial page";
const RATIONALE_CLOSE_GROUP = "Link within close group";

export async function runReactimus(
  clientKey: string,
  urls: string[] | undefined,
  logFn?: (message: string) => void,
): Promise<{ ok: boolean; message: string; snapshot?: ReactimusSnapshot }> {
  const log = logFn ?? (() => {});
  const app = getAppConfig();
  if (!app.hasGoogleCredentials) {
    return { ok: false, message: "Google credentials are not configured, so live GSC data isn't available." };
  }

  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return { ok: false, message: "Unknown client." };

  const masterPages = config.masterPages.filter((p) => p.client_key === clientKey && p.active);
  const masterByUrl = new Map(masterPages.map((p) => [normUrl(p.url), p]));

  const runnable = await reactimusPages(clientKey);
  if (runnable.length === 0) {
    return {
      ok: false,
      message: "This client has no pages yet — build the master page list (or add key pages) first.",
    };
  }
  const selected = new Set((urls ?? []).map(normUrl).filter(Boolean));
  const inputs = (selected.size > 0
    ? runnable.filter((p) => selected.has(normUrl(p.url)))
    : runnable
  ).slice(0, MAX_PAGES_PER_RUN);
  if (selected.size > 0 && inputs.length === 0) {
    return { ok: false, message: "None of the selected pages are in this client's page list." };
  }
  log(`Analysing ${inputs.length} page(s).`);

  const property = await resolveGscSiteUrl(client);
  log(`GSC property: ${property}`);

  const useLlm = process.env.REACTIMUS_LLM !== "none" && Boolean(app.anthropicApiKey);
  const toolConfig: ToolConfig = {
    ...DEFAULT_CONFIG,
    clientName: client.client_name,
    website: `https://${client.domain}/`,
    gscProperty: property,
    llmProvider: useLlm ? "anthropic" : "none",
    llmModel: app.anthropicModel,
  };

  // Site inventory: the whole master list when it exists (every page with its
  // primary keyword), so cannibalisation and better-page checks see the full
  // site. Key pages remain the fallback for clients without a master list.
  const inventory: PageRow[] =
    masterPages.length > 0
      ? masterPages.map((p) => ({
          url: p.url,
          include: "TRUE",
          pageType: "",
          primaryTopic: p.primary_keyword,
          targetIntent:
            p.intent === "commercial"
              ? ("commercial" as const)
              : p.intent === "informational"
                ? ("informational" as const)
                : ("" as const),
          titleTag: p.title,
          h1: p.h1,
          canonicalUrl: "",
          businessPriority: "",
          notes: p.notes,
          lastAnalysed: "",
          status: "",
        }))
      : config.clientPages
          .filter((p) => p.client_key === clientKey && p.active)
          .map((p) => ({
            url: p.url,
            include: "TRUE",
            pageType: p.content_type,
            primaryTopic: p.label,
            targetIntent: p.commercial_priority === "high" ? ("commercial" as const) : ("" as const),
            titleTag: "",
            h1: "",
            canonicalUrl: "",
            businessPriority: p.commercial_priority,
            notes: p.notes,
            lastAnalysed: "",
            status: "",
          }));
  const inventoryByUrl = new Map(inventory.map((p) => [normUrl(p.url), p]));
  if (masterPages.length > 0) log(`Site awareness: master list with ${masterPages.length} page(s).`);
  else log("Site awareness: key pages only — build the master page list for full-site awareness.");

  // --- Pull GSC queries + fetch each page ---
  const allRaw: GscRawRow[] = [];
  const pages = new Map<string, PageContentRow>();
  const pageStatuses: ReactimusSnapshot["pagesAnalysed"] = [];
  let windowStart = "";
  let windowEnd = "";

  const analysedAt = new Date().toISOString();
  for (const input of inputs) {
    log(`Pulling GSC queries for ${input.url} …`);
    const { rows, error } = await queriesForUrl(toolConfig, input.url);
    allRaw.push(...rows);
    if (rows[0]) {
      windowStart = rows[0].startDate;
      windowEnd = rows[0].endDate;
    }
    const page = await fetchPageContent(input.url, 20000, log);
    pages.set(normUrl(input.url), page);
    const statusBits = [
      error ? `GSC error: ${error}` : `${rows.length} queries`,
      page.httpStatus === 200 ? "page fetched" : `page fetch failed (HTTP ${page.httpStatus})`,
    ];
    pageStatuses.push({ url: input.url, status: statusBits.join(" · "), queries: rows.length, analysedAt });
  }

  // --- Group (strict, then commercial synonyms), score, classify ---
  const compiled = compileRules([], { client: client.client_name, site: property });
  const groups = mergeCommercialSynonyms(groupQueries(allRaw, compiled));
  const analysed: AnalysedGroup[] = [];
  const perUrlCount = new Map<string, number>();

  for (const group of groups) {
    const key = normUrl(group.url);
    const count = perUrlCount.get(key) ?? 0;
    if (count >= toolConfig.maxQueryGroupsPerUrl) continue;
    perUrlCount.set(key, count + 1);

    const page = pages.get(key);
    if (!page) continue;
    const inputMeta = inventoryByUrl.get(key);
    const pageUnavailable = page.httpStatus !== 200;
    const mention: MentionResult = pageUnavailable
      ? {
          mentioned: false,
          type: "unknown",
          evidence: `page not fetched (HTTP ${page.httpStatus}) — on-page checks skipped`,
          location: "",
        }
      : detectMention(group, page);
    const scores = scoreGroup(group, mention, { page, inputMeta, inventory, config: toolConfig });

    let result = analyseGroup(group, scores, mention, compiled);
    if (pageUnavailable) {
      result = {
        ...result,
        confidence: Math.min(result.confidence, 0.4),
        rationale: `PAGE CONTENT UNAVAILABLE (HTTP ${page.httpStatus}) — verify against the live page. ${result.rationale}`,
      };
    }
    analysed.push(result);
  }
  log(`Analysed ${analysed.length} keyword group(s) from ${allRaw.length} raw queries.`);

  // --- Turn analysed groups into action rows ---
  const isBrandDominated = brandQueryTest(client.client_name);
  const unreadableUrls = new Set(
    [...pages.entries()].filter(([, p]) => p.httpStatus !== 200).map(([key]) => key),
  );

  const actions: ReactimusAction[] = [];
  let rejectedCount = 0;
  const variantsOf = (g: AnalysedGroup) => g.variants.map((v) => v.query).join("; ");

  const ON_PAGE: Record<string, ReactimusActionType> = {
    add_to_h2: "H2 edit",
    add_to_body: "Copy edit",
    add_to_faq: "FAQ",
  };

  const newPageGroups: AnalysedGroup[] = [];
  for (const g of analysed) {
    const pageKey = normUrl(g.url);
    if (g.category === "reject") {
      rejectedCount++;
      continue;
    }
    if (g.category === "new_commercial_page" || g.category === "new_supporting_content") {
      if (!unreadableUrls.has(pageKey) && !isBrandDominated(g.canonicalQuery)) newPageGroups.push(g);
      else rejectedCount++;
      continue;
    }
    if (g.category === "link_to_existing_page") {
      const target = g.scores.betterExistingUrl;
      if (!target) {
        rejectedCount++;
        continue;
      }
      const page = pages.get(pageKey);
      const alreadyLinked = (page?.linkedUrls ?? []).some((l) => normUrl(l) === normUrl(target));
      const anchor = page && !unreadableUrls.has(pageKey) ? pickAnchorSentence(page, g.canonicalQuery) : "";
      if (anchor && !alreadyLinked) {
        actions.push({
          key: "",
          pageUrl: g.url,
          sourceUrl: g.url,
          keyword: g.canonicalQuery,
          variants: variantsOf(g),
          action: "Internal link",
          rationale: RATIONALE_LINK,
          why: `Searchers typing "${g.canonicalQuery}" are better served by ${target} — link them across from this page.`,
          before: anchor,
          after: `${anchor}\n\nLink to: ${target}`,
          targetUrl: target,
          clicks: g.totalClicks,
          impressions: g.totalImpressions,
          confidence: g.confidence,
          status: "ready_to_review",
        });
      } else {
        // No natural anchor (or the link already exists): file a task under
        // the page that owns the keyword instead.
        actions.push({
          key: "",
          pageUrl: target,
          sourceUrl: g.url,
          keyword: g.canonicalQuery,
          variants: variantsOf(g),
          action: "Task",
          rationale: "Belongs to this page",
          why: `Searches for "${g.canonicalQuery}" currently reach ${g.url}, but this page is the better fit. Make sure the phrase is covered here.`,
          before: "",
          after: `Cover "${g.canonicalQuery}" on this page (heading or body copy), so it takes over from ${g.url} in search.`,
          targetUrl: g.url,
          clicks: g.totalClicks,
          impressions: g.totalImpressions,
          confidence: g.confidence,
          status: "ready_to_review",
        });
      }
      continue;
    }
    const actionType = ON_PAGE[g.category];
    if (!actionType) continue;
    const rationale =
      actionType === "FAQ"
        ? RATIONALE_QUESTION
        : g.scores.commerciality >= 4
          ? RATIONALE_COMMERCIAL
          : RATIONALE_PHRASE;
    actions.push({
      key: "",
      pageUrl: g.url,
      sourceUrl: g.url,
      keyword: g.canonicalQuery,
      variants: variantsOf(g),
      action: actionType,
      rationale,
      why: g.rationale,
      before: "",
      after: "",
      targetUrl: "",
      clicks: g.totalClicks,
      impressions: g.totalImpressions,
      confidence: g.confidence,
      status: "ready_to_review",
    });
  }

  // New-page ideas (consolidated so one missing topic = one row).
  for (const cluster of consolidateNewPageGroups(newPageGroups)) {
    const idea = buildNewPageIdea(cluster, toolConfig);
    actions.push({
      key: "",
      pageUrl: idea.sourceUrl,
      sourceUrl: idea.sourceUrl,
      keyword: idea.sourceQueryGroup,
      variants: idea.supportingQueryVariants,
      action: "New page",
      rationale: idea.commercialOrInformational === "commercial" ? "Missing commercial page" : "Missing supporting content",
      why: idea.whySeparatePage,
      before: "",
      after: [
        `New page: ${idea.suggestedPageIdea}`,
        idea.suggestedUrlSlug ? `Suggested URL: ${idea.suggestedUrlSlug}` : "",
        idea.internalLinkingOpportunity ? `Internal links: ${idea.internalLinkingOpportunity}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      targetUrl: "",
      clicks: idea.totalClicks,
      impressions: idea.totalImpressions,
      confidence: idea.confidence,
      status: "ready_to_review",
    });
  }

  // Close-group internal links: pages in the same close group are natural
  // link partners, so surface any partner whose primary keyword appears in
  // the analysed page's copy without a link yet.
  for (const input of inputs) {
    const pageKey = normUrl(input.url);
    const master = masterByUrl.get(pageKey);
    const page = pages.get(pageKey);
    if (!master?.close_group || !page || page.httpStatus !== 200) continue;
    const partners = masterPages.filter(
      (p) => p.close_group === master.close_group && normUrl(p.url) !== pageKey && p.primary_keyword,
    );
    let added = 0;
    for (const partner of partners) {
      if (added >= 3) break;
      const alreadyLinked = (page.linkedUrls ?? []).some((l) => normUrl(l) === normUrl(partner.url));
      if (alreadyLinked) continue;
      const kwTokens = draftTokens(partner.primary_keyword);
      const bodyTokens = new Set(draftTokens(page.bodyText));
      if (kwTokens.length === 0 || !kwTokens.every((t) => bodyTokens.has(t))) continue;
      const anchor = pickAnchorSentence(page, partner.primary_keyword);
      if (!anchor) continue;
      actions.push({
        key: "",
        pageUrl: input.url,
        sourceUrl: input.url,
        keyword: partner.primary_keyword,
        variants: "",
        action: "Internal link",
        rationale: RATIONALE_CLOSE_GROUP,
        why: `This page already talks about "${partner.primary_keyword}" but doesn't link to its page (same close group: ${master.close_group}).`,
        before: anchor,
        after: `${anchor}\n\nLink to: ${partner.url}`,
        targetUrl: partner.url,
        clicks: 0,
        impressions: 0,
        confidence: 0.7,
        status: "ready_to_review",
      });
      added++;
    }
  }

  // Assign keys and dedupe (same page + action + keyword keeps the stronger row).
  const byKey = new Map<string, ReactimusAction>();
  for (const a of actions) {
    a.key = actionKey(a);
    const existing = byKey.get(a.key);
    if (!existing || a.impressions > existing.impressions) byKey.set(a.key, a);
  }
  const finalActions = [...byKey.values()];

  // --- Draft before/after copy for the on-page rows, one call per page ---
  if (useLlm) log(`Claude drafting before/after edits (${toolConfig.llmModel}) …`);
  for (const input of inputs) {
    const pageKey = normUrl(input.url);
    const page = pages.get(pageKey);
    if (!page || page.httpStatus !== 200) continue;
    const draftables: DraftableAction[] = finalActions
      .filter((a) => normUrl(a.pageUrl) === pageKey && (a.action === "H2 edit" || a.action === "Copy edit" || a.action === "FAQ"))
      .map((a) => ({ key: a.key, action: a.action as DraftableAction["action"], keyword: a.keyword, variants: a.variants }));
    if (draftables.length === 0) continue;
    const drafted = useLlm
      ? await draftBeforeAfters(app.anthropicApiKey!, app.anthropicModel, client.client_name, page, draftables, log)
      : new Map<string, { before: string; after: string }>();
    for (const a of finalActions) {
      if (normUrl(a.pageUrl) !== pageKey || !(a.action in ON_PAGE_SET)) continue;
      const d = drafted.get(a.key);
      if (d) {
        a.before = d.before;
        a.after = d.after;
      } else if (!a.before && !a.after) {
        const fallback = heuristicBeforeAfter(
          { key: a.key, action: a.action as DraftableAction["action"], keyword: a.keyword, variants: a.variants },
          page,
        );
        a.before = fallback.before;
        a.after = fallback.after;
      }
      // The edit tracker's core rule, learned the hard way: an edit whose
      // "after" doesn't contain the keyword is useless. Flag rather than drop.
      if (a.after && !containsKeywordish(a.after, a.keyword)) {
        a.why = `${a.why} NOTE: check the keyword actually features in the suggested copy.`;
      }
    }
  }

  // --- Fresh per-page results: rows from this run replace everything the
  // run's pages produced before; other pages keep their latest rows. ---
  const previous = readReactimusSnapshot(clientKey);
  const runUrls = new Set(inputs.map((p) => normUrl(p.url)));
  const keptActions = (previous?.actions ?? []).filter((a) => !runUrls.has(normUrl(a.sourceUrl)));
  // A cross-page task's row lives under its target page; drop stale ones too.
  const allActions = [...keptActions, ...finalActions];

  // Statuses and "added" markers survive for rows that came out identical.
  const prevByKey = new Map((previous?.actions ?? []).map((a) => [a.key, a]));
  for (const a of allActions) {
    const prev = prevByKey.get(a.key);
    if (prev && prev.status !== "ready_to_review") a.status = prev.status;
  }
  const liveKeys = new Set(allActions.map((a) => a.key));
  const added: Record<string, string> = {};
  for (const [key, period] of Object.entries(previous?.added ?? {})) {
    if (liveKeys.has(key)) added[key] = period;
  }

  const pagesAnalysed = [
    ...(previous?.pagesAnalysed ?? []).filter((p) => !runUrls.has(normUrl(p.url))),
    ...pageStatuses,
  ];

  const snapshot: ReactimusSnapshot = {
    version: SNAPSHOT_VERSION,
    clientKey,
    clientName: client.client_name,
    generatedAt: new Date().toISOString(),
    window: { start: windowStart, end: windowEnd },
    property,
    llm: useLlm ? "anthropic" : "none",
    pagesAnalysed,
    actions: allActions,
    rejectedCount,
    added,
    // Archived (ruled-out) suggestions carry over in full: the whole point
    // is that a ruled-out idea stays ruled out on every future run.
    archived: previous?.archived ?? {},
  };
  writeReactimusSnapshot(snapshot);
  log(`Done: ${finalActions.length} action(s) for the selected pages; ${rejectedCount} keyword group(s) rejected.`);
  return { ok: true, message: "Analysis complete.", snapshot };
}

const ON_PAGE_SET: Record<string, true> = { "H2 edit": true, "Copy edit": true, FAQ: true };

/** Loose containment check: every content token of the keyword (or a close
 * inflection) appears in the text. */
function containsKeywordish(text: string, keyword: string): boolean {
  const textTokens = draftTokens(text);
  const stem = (t: string) => t.replace(/(ies|es|s|ing|ed)$/, "");
  const stems = new Set(textTokens.map(stem));
  return draftTokens(keyword).every((t) => stems.has(stem(t)));
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

const VALID_STATUSES: ReactimusStatus[] = ["ready_to_review", "approved", "not_approved", "implemented"];

export async function setReactimusStatus(input: {
  clientKey: string;
  key: string;
  status: string;
}): Promise<ActionResult> {
  const snapshot = readReactimusSnapshot(input.clientKey);
  if (!snapshot) return { ok: false, message: "Run the analysis first." };
  if (!VALID_STATUSES.includes(input.status as ReactimusStatus)) {
    return { ok: false, message: "Unknown status." };
  }
  const action = snapshot.actions.find((a) => a.key === input.key);
  if (!action) return { ok: false, message: "Row not found — re-run the analysis and try again." };
  action.status = input.status as ReactimusStatus;
  writeReactimusSnapshot(snapshot);
  return { ok: true, message: "Status saved." };
}

// ---------------------------------------------------------------------------
// "Add to report": create a strategic note for the client's latest month
// ---------------------------------------------------------------------------

const shortPathOf = (url: string) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

export async function addReactimusToReport(input: {
  clientKey: string;
  key: string;
}): Promise<ActionResult> {
  const snapshot = readReactimusSnapshot(input.clientKey);
  if (!snapshot) return { ok: false, message: "Run the analysis first." };

  const action = snapshot.actions.find((a) => a.key === input.key);
  if (!action) return { ok: false, message: "Suggestion not found — re-run the analysis and try again." };

  const { config } = await loadAdminConfig();
  const period = config.reportPeriods
    .filter((p) => p.client_key === input.clientKey)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  if (!period) return { ok: false, message: "This client has no report months yet." };

  const bodyBits = [action.why];
  if (action.before) bodyBits.push(`Current copy: "${action.before}"`);
  if (action.after) bodyBits.push(`Suggested: ${action.after}`);
  const row: StrategicNoteRow = {
    client_key: input.clientKey,
    period_key: period.period_key,
    note_type: "reactimus",
    title: `${action.action}: "${action.keyword}" on ${shortPathOf(action.pageUrl)}`,
    body: bodyBits.filter(Boolean).join(" "),
    priority: action.impressions >= 500 ? "high" : action.impressions >= 100 ? "medium" : "low",
    active: true,
  };
  await appendRowsAnywhere("StrategicNotes", [row as unknown as Record<string, unknown>]);

  // Show it in the draft report straight away.
  const draft = readSnapshot(input.clientKey, period.period_key);
  if (draft) {
    const updated: ReportSnapshot = { ...draft, strategicNotes: [...draft.strategicNotes, row] };
    fs.writeFileSync(
      path.join(REPORTS_DIR, input.clientKey, `${period.period_key}.json`),
      JSON.stringify(updated, null, 2),
    );
  }

  snapshot.added[input.key] = period.period_key;
  writeReactimusSnapshot(snapshot);

  return {
    ok: true,
    message: `Added to ${period.label}'s strategic priorities${draft ? "" : " (generate the report to see it)"}.`,
  };
}

// ---------------------------------------------------------------------------
// Archive: rule a suggestion out so it stays suppressed on every future run
// ---------------------------------------------------------------------------

export async function archiveReactimusSuggestion(input: {
  clientKey: string;
  key: string;
}): Promise<ActionResult> {
  const snapshot = readReactimusSnapshot(input.clientKey);
  if (!snapshot) return { ok: false, message: "Run the analysis first." };
  const action = snapshot.actions.find((a) => a.key === input.key);
  if (!action) return { ok: false, message: "Suggestion not found." };
  snapshot.archived[input.key] = {
    archivedAt: new Date().toISOString(),
    kind: action.action,
    title: `"${action.keyword}" on ${shortPathOf(action.pageUrl)}`,
    detail: action.rationale,
  };
  writeReactimusSnapshot(snapshot);
  return { ok: true, message: "Archived — it won't come back on future runs unless you restore it." };
}

export async function restoreReactimusSuggestion(input: {
  clientKey: string;
  key: string;
}): Promise<ActionResult> {
  const snapshot = readReactimusSnapshot(input.clientKey);
  if (!snapshot) return { ok: false, message: "Run the analysis first." };
  if (!snapshot.archived[input.key]) return { ok: false, message: "That item isn't in the archive." };
  delete snapshot.archived[input.key];
  writeReactimusSnapshot(snapshot);
  return { ok: true, message: "Restored — it will show as a live suggestion again." };
}

/** Re-export for UI/master-list callers. */
export type { MasterPageRow };
