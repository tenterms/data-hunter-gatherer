import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { DATA_DIR, getAppConfig, REPORTS_DIR } from "./config";
import { getGoogleAuth, loadAdminConfig } from "./sheets";
import { resolveGscSiteUrl } from "./gsc";
import { appendRowsAnywhere } from "./rowStore";
import { readSnapshot } from "./snapshots";
import type { ActionResult } from "./adminActions";
import type { ReportSnapshot, StrategicNoteRow } from "./types";

import { DEFAULT_CONFIG } from "@/reactimus/config/defaults";
import { groupQueries } from "@/reactimus/grouping/grouper";
import { detectMention } from "@/reactimus/mentions/detector";
import { scoreGroup } from "@/reactimus/scoring/heuristics";
import { analyseGroup } from "@/reactimus/classify/decisionRules";
import { buildNewPageIdea, buildRecommendation } from "@/reactimus/recommendations/generator";
import { consolidateNewPageGroups } from "@/reactimus/recommendations/consolidate";
import { applyLlmDrafts, buildSuggestedEdits } from "@/reactimus/recommendations/suggestedEdits";
import { compileRules } from "@/reactimus/rules/engine";
import { createLlmAdapter } from "@/reactimus/llm/adapter";
import { fetchPageContent } from "@/reactimus/content/fetcher";
import type {
  AnalysedGroup,
  GscRawRow,
  MentionResult,
  NewPageIdeaRow,
  PageContentRow,
  PageRow,
  RecommendationRow,
  SuggestedEditRow,
  ToolConfig,
} from "@/reactimus/types";

/**
 * Reactimus inside the reporting app: page-improvement and new-page
 * suggestions from live GSC data, run per client against their key pages.
 * The Google-Sheets review workflow from the standalone tool is replaced by
 * a JSON snapshot per client plus "Add to report" actions that create
 * strategic notes for the client's latest month.
 */

export const REACTIMUS_DIR = path.join(DATA_DIR, "reactimus");
const MAX_PAGES_PER_RUN = 15;

/** A ruled-out suggestion: suppressed on every future run until restored. */
export interface ArchivedSuggestion {
  archivedAt: string;
  kind: string;
  title: string;
  detail: string;
}

export interface ReactimusSnapshot {
  clientKey: string;
  clientName: string;
  generatedAt: string;
  window: { start: string; end: string };
  property: string;
  llm: string;
  pagesAnalysed: Array<{ url: string; status: string; queries: number }>;
  recommendations: RecommendationRow[];
  suggestedEdits: SuggestedEditRow[];
  newPageIdeas: NewPageIdeaRow[];
  rejectedCount: number;
  /** suggestion key -> period_key it was added to the report for */
  added: Record<string, string>;
  /** suggestion key -> archive entry; carried across runs so a ruled-out
   * suggestion never has to be ruled out again */
  archived: Record<string, ArchivedSuggestion>;
}

const normUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");
export const editKey = (e: SuggestedEditRow) =>
  `edit##${normUrl(e.url)}##${e.editType}##${(e.keywordsTargeted.split(";")[0] ?? "").trim().toLowerCase()}`;
export const ideaKey = (i: NewPageIdeaRow) =>
  `idea##${normUrl(i.sourceUrl)}##${i.suggestedPageIdea.trim().toLowerCase()}`;
export const recKey = (r: RecommendationRow) =>
  `rec##${normUrl(r.url)}##${r.canonicalQueryGroup.trim().toLowerCase()}`;

function snapshotFile(clientKey: string): string {
  return path.join(REACTIMUS_DIR, `${clientKey}.json`);
}

export function readReactimusSnapshot(clientKey: string): ReactimusSnapshot | null {
  if (!/^[a-z0-9_-]+$/i.test(clientKey)) return null;
  const file = snapshotFile(clientKey);
  if (!fs.existsSync(file)) return null;
  try {
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8")) as ReactimusSnapshot;
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

export async function runReactimus(
  clientKey: string,
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

  const keyPages = config.clientPages.filter((p) => p.client_key === clientKey && p.active);
  if (keyPages.length === 0) {
    return {
      ok: false,
      message: "This client has no key pages yet — add some in the Key pages tab first (Reactimus analyses those pages).",
    };
  }
  // Primary pages first, and a sane cap so a run stays quick.
  const roleOrder: Record<string, number> = { primary: 0, secondary: 1, supporting: 2, rest_of_site: 3 };
  const inputsAll = [...keyPages].sort(
    (a, b) => (roleOrder[a.page_role] ?? 9) - (roleOrder[b.page_role] ?? 9),
  );
  const inputs = inputsAll.slice(0, MAX_PAGES_PER_RUN);
  if (inputsAll.length > inputs.length) {
    log(`Analysing the first ${inputs.length} of ${inputsAll.length} key pages (per-run cap).`);
  }

  const property = await resolveGscSiteUrl(client);
  log(`GSC property: ${property}`);

  // Reactimus is deterministic by default; set REACTIMUS_LLM=anthropic to let
  // Claude also polish the suggested copy (one call per edit).
  const useLlm = process.env.REACTIMUS_LLM === "anthropic" && Boolean(app.anthropicApiKey);
  const toolConfig: ToolConfig = {
    ...DEFAULT_CONFIG,
    clientName: client.client_name,
    website: `https://${client.domain}/`,
    gscProperty: property,
    llmProvider: useLlm ? "anthropic" : "none",
    llmModel: app.anthropicModel,
  };

  // Site inventory = every key page (feeds the cannibalisation checks).
  const inventory: PageRow[] = keyPages.map((p) => ({
    url: p.url,
    include: "TRUE",
    pageType: p.content_type,
    primaryTopic: p.label,
    targetIntent: p.commercial_priority === "high" ? "commercial" : "",
    titleTag: "",
    h1: "",
    canonicalUrl: "",
    businessPriority: p.commercial_priority,
    notes: p.notes,
    lastAnalysed: "",
    status: "",
  }));
  const inventoryByUrl = new Map(inventory.map((p) => [normUrl(p.url), p]));

  // --- Pull GSC queries + fetch each page ---
  const allRaw: GscRawRow[] = [];
  const pages = new Map<string, PageContentRow>();
  const pageStatuses: ReactimusSnapshot["pagesAnalysed"] = [];
  let windowStart = "";
  let windowEnd = "";

  for (const input of inputs) {
    log(`Pulling GSC queries for ${input.url} …`);
    const { rows, error } = await queriesForUrl(toolConfig, input.url);
    allRaw.push(...rows);
    if (rows[0]) {
      windowStart = rows[0].startDate;
      windowEnd = rows[0].endDate;
    }
    const page = await fetchPageContent(input.url);
    pages.set(normUrl(input.url), page);
    const statusBits = [
      error ? `GSC error: ${error}` : `${rows.length} queries`,
      page.httpStatus === 200 ? "page fetched" : `page fetch failed (HTTP ${page.httpStatus})`,
    ];
    pageStatuses.push({ url: input.url, status: statusBits.join(" · "), queries: rows.length });
  }

  // --- Group, score, classify (mirrors the standalone pipeline core) ---
  const compiled = compileRules([], { client: client.client_name, site: property });
  const llm = await createLlmAdapter(toolConfig);
  if (llm.name !== "none") log(`LLM polish enabled (${toolConfig.llmModel}).`);

  const groups = groupQueries(allRaw, compiled);
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
  log(`Analysed ${analysed.length} query group(s) from ${allRaw.length} raw queries.`);

  const NEW_PAGE = new Set(["new_commercial_page", "new_supporting_content"]);
  const actionable = analysed.filter((g) => g.category !== "reject" && !NEW_PAGE.has(g.category));
  const rejected = analysed.filter((g) => g.category === "reject");
  const newPageGroups = analysed.filter((g) => NEW_PAGE.has(g.category));

  const recommendations = actionable.map(buildRecommendation);
  const suggestedEdits = buildSuggestedEdits(analysed, pages, toolConfig);
  const drafted = await applyLlmDrafts(suggestedEdits, pages, toolConfig, llm);
  if (drafted > 0) log(`Claude drafted publishable copy for ${drafted} edit(s).`);
  const newPageIdeas = consolidateNewPageGroups(newPageGroups).map((c) =>
    buildNewPageIdea(c, toolConfig),
  );

  // Carry "added to report" markers across runs.
  const previous = readReactimusSnapshot(clientKey);
  const added: Record<string, string> = {};
  if (previous?.added) {
    const liveKeys = new Set([
      ...suggestedEdits.map(editKey),
      ...newPageIdeas.map(ideaKey),
      ...recommendations.map(recKey),
    ]);
    for (const [key, period] of Object.entries(previous.added)) {
      if (liveKeys.has(key)) added[key] = period;
    }
  }

  const snapshot: ReactimusSnapshot = {
    clientKey,
    clientName: client.client_name,
    generatedAt: new Date().toISOString(),
    window: { start: windowStart, end: windowEnd },
    property,
    llm: llm.name,
    pagesAnalysed: pageStatuses,
    recommendations,
    suggestedEdits,
    newPageIdeas,
    rejectedCount: rejected.length,
    added,
    // Archived (ruled-out) suggestions carry over in full: the whole point
    // is that a ruled-out idea stays ruled out on every future run.
    archived: previous?.archived ?? {},
  };
  writeReactimusSnapshot(snapshot);
  log(
    `Done: ${suggestedEdits.length} page improvement(s), ${newPageIdeas.length} new page idea(s), ${rejected.length} rejected group(s).`,
  );
  return { ok: true, message: "Analysis complete.", snapshot };
}

// ---------------------------------------------------------------------------
// "Add to report": create a strategic note for the client's latest month
// ---------------------------------------------------------------------------

export async function addReactimusToReport(input: {
  clientKey: string;
  key: string;
}): Promise<ActionResult> {
  const snapshot = readReactimusSnapshot(input.clientKey);
  if (!snapshot) return { ok: false, message: "Run the analysis first." };

  const { config } = await loadAdminConfig();
  const period = config.reportPeriods
    .filter((p) => p.client_key === input.clientKey)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  if (!period) return { ok: false, message: "This client has no report months yet." };

  const shortPath = (url: string) => {
    try {
      return new URL(url).pathname || "/";
    } catch {
      return url;
    }
  };

  let note: Omit<StrategicNoteRow, "client_key" | "period_key" | "active"> | null = null;
  const edit = snapshot.suggestedEdits.find((e) => editKey(e) === input.key);
  if (edit) {
    note = {
      note_type: "reactimus",
      title: `Page improvement: ${edit.editType.toLowerCase()} for "${edit.keywordsTargeted.split(";")[0]?.trim()}" on ${shortPath(edit.url)}`,
      body: [`${edit.whereOnPage}.`, edit.why, `Suggested copy: ${edit.suggestedCopy}`]
        .filter(Boolean)
        .join(" "),
      priority: edit.priority,
    };
  }
  const idea = snapshot.newPageIdeas.find((i) => ideaKey(i) === input.key);
  if (idea) {
    note = {
      note_type: "reactimus",
      title: `New page idea: ${idea.suggestedPageIdea}`,
      body: [
        idea.whySeparatePage,
        `Search demand: ${idea.totalImpressions.toLocaleString("en-GB")} impressions across "${idea.supportingQueryVariants.split(";")[0]?.trim()}" and related searches.`,
        idea.suggestedUrlSlug ? `Suggested URL: ${idea.suggestedUrlSlug}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      priority: idea.priority,
    };
  }
  const rec = snapshot.recommendations.find((r) => recKey(r) === input.key);
  if (!note && rec) {
    note = {
      note_type: "reactimus",
      title: `${rec.recommendationType.replace(/_/g, " ")}: "${rec.canonicalQueryGroup}" on ${shortPath(rec.url)}`,
      body: [rec.searchDemandSummary, rec.suggestedContentTweak].filter(Boolean).join(" "),
      priority: rec.priority,
    };
  }
  if (!note) return { ok: false, message: "Suggestion not found — re-run the analysis and try again." };

  const row: StrategicNoteRow = {
    client_key: input.clientKey,
    period_key: period.period_key,
    ...note,
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

const shortPathOf = (url: string) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

/** Compact display info for a suggestion, so the archive stays browsable
 * even after the underlying suggestion stops being generated. */
function describeSuggestion(
  snapshot: ReactimusSnapshot,
  key: string,
): Omit<ArchivedSuggestion, "archivedAt"> | null {
  const edit = snapshot.suggestedEdits.find((e) => editKey(e) === key);
  if (edit) {
    return {
      kind: "Page improvement",
      title: `${edit.editType} on ${shortPathOf(edit.url)}`,
      detail: edit.keywordsTargeted.split(";").slice(0, 3).join(";"),
    };
  }
  const idea = snapshot.newPageIdeas.find((i) => ideaKey(i) === key);
  if (idea) {
    return {
      kind: "New page idea",
      title: idea.suggestedPageIdea,
      detail: `${idea.totalImpressions.toLocaleString("en-GB")} impressions`,
    };
  }
  const rec = snapshot.recommendations.find((r) => recKey(r) === key);
  if (rec) {
    return {
      kind: "Recommendation",
      title: `${rec.recommendationType.replace(/_/g, " ")}: "${rec.canonicalQueryGroup}" on ${shortPathOf(rec.url)}`,
      detail: rec.searchDemandSummary,
    };
  }
  return null;
}

export async function archiveReactimusSuggestion(input: {
  clientKey: string;
  key: string;
}): Promise<ActionResult> {
  const snapshot = readReactimusSnapshot(input.clientKey);
  if (!snapshot) return { ok: false, message: "Run the analysis first." };
  const described = describeSuggestion(snapshot, input.key);
  if (!described) return { ok: false, message: "Suggestion not found." };
  snapshot.archived[input.key] = { archivedAt: new Date().toISOString(), ...described };
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
