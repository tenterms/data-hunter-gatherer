import fs from "fs";
import path from "path";
import { getAppConfig, REPORTS_DIR } from "./config";
import { loadAdminConfig, recordGeneratedReport } from "./sheets";
import { LiveGscAdapter, MockGscAdapter, type GscAdapter } from "./gsc";
import {
  LocalCsvRankingProvider,
  SERankingProvider,
  SheetImportRankingProvider,
  resolveRankings,
  type RankingProvider,
} from "./rankings";
import { aggregateRows, compareMetricSets, EMPTY_METRICS, formatChangePct, formatNumber, formatPct, formatPosition } from "./metrics";
import { calculateContentGroups, urlMatches } from "./contentGroups";
import { calculateTopicClusters } from "./topicClusters";
import { findCannibalisation } from "./cannibalisation";
import { buildFindings } from "./findingsEngine";
import { buildCommentary } from "./commentary";
import { createLlmProvider } from "./llmCommentary";
import type {
  AdminConfig,
  ClientRow,
  GscRow,
  KpiCardData,
  MetricSet,
  PagePerformance,
  ReportPeriodRow,
  ReportSnapshot,
} from "./types";

export interface GenerateReportOptions {
  clientKey: string;
  periodKey: string;
  /** force mock data even if credentials exist (useful for demos) */
  forceMock?: boolean;
  log?: (message: string) => void;
}

function normaliseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function metricsForUrl(rows: GscRow[], url: string): MetricSet {
  const target = normaliseUrl(url);
  return aggregateRows(rows.filter((r) => normaliseUrl(r.keys[0] ?? "") === target));
}

function buildKpis(snapshotLike: {
  site: { current: MetricSet; previous: MetricSet };
  rankings: { top10: { current: number; previous: number }; positionsUp: number; positionsDown: number; keywordsTracked: number };
}): KpiCardData[] {
  const { site, rankings } = snapshotLike;
  const clicks = compareMetricSets(site.current, site.previous).clicks;
  const impressions = compareMetricSets(site.current, site.previous).impressions;
  const ctr = compareMetricSets(site.current, site.previous).ctr;

  const kpis: KpiCardData[] = [
    {
      key: "clicks",
      label: "Total clicks",
      value: formatNumber(site.current.clicks),
      changeLabel: `${formatChangePct(clicks)} vs previous`,
      sentiment: clicks.change > 0 ? "positive" : clicks.change < 0 ? "negative" : "neutral",
    },
    {
      key: "impressions",
      label: "Total impressions",
      value: formatNumber(site.current.impressions),
      changeLabel: `${formatChangePct(impressions)} vs previous`,
      sentiment: impressions.change > 0 ? "positive" : impressions.change < 0 ? "negative" : "neutral",
    },
    {
      key: "ctr",
      label: "Click-through rate",
      value: formatPct(site.current.ctr, 2),
      changeLabel: `from ${formatPct(site.previous.ctr, 2)}`,
      sentiment: ctr.change > 0 ? "positive" : ctr.change < 0 ? "negative" : "neutral",
    },
    {
      key: "avg_position",
      label: "Avg. position (GSC)",
      value: formatPosition(site.current.position),
      changeLabel:
        site.previous.position !== null ? `from ${formatPosition(site.previous.position)}` : null,
      sentiment:
        site.current.position !== null && site.previous.position !== null
          ? site.current.position < site.previous.position
            ? "positive"
            : site.current.position > site.previous.position
              ? "negative"
              : "neutral"
          : "neutral",
    },
  ];

  if (rankings.keywordsTracked > 0) {
    const top10Change = rankings.top10.current - rankings.top10.previous;
    kpis.push({
      key: "top10",
      label: "Keywords in top 10",
      value: String(rankings.top10.current),
      changeLabel: `${top10Change >= 0 ? "+" : ""}${top10Change} vs previous`,
      sentiment: top10Change > 0 ? "positive" : top10Change < 0 ? "negative" : "neutral",
    });
  }
  return kpis;
}

export async function generateReport(options: GenerateReportOptions): Promise<{ snapshot: ReportSnapshot; snapshotPath: string }> {
  const log = options.log ?? console.log;
  const app = getAppConfig();

  const { config, source: configSource } = await loadAdminConfig();
  log(`Admin config loaded from ${configSource}.`);

  const client = config.clients.find((c) => c.client_key === options.clientKey);
  if (!client) {
    throw new Error(
      `Unknown client "${options.clientKey}". Known clients: ${config.clients.map((c) => c.client_key).join(", ")}`,
    );
  }
  const period = config.reportPeriods.find(
    (p) => p.client_key === options.clientKey && p.period_key === options.periodKey,
  );
  if (!period) {
    throw new Error(
      `No report period "${options.periodKey}" for client "${options.clientKey}". Add it to the ReportPeriods tab.`,
    );
  }

  // --- Fetch GSC data (live or mock) ---------------------------------------
  const useLive = app.hasGoogleCredentials && !options.forceMock;
  let gsc: GscAdapter = useLive ? new LiveGscAdapter() : new MockGscAdapter(config);
  log(`Fetching GSC data via ${gsc.source} adapter…`);

  const currentRange = { startDate: period.start_date, endDate: period.end_date };
  const comparisonRange = {
    startDate: period.comparison_start_date,
    endDate: period.comparison_end_date,
  };
  let current;
  let comparison;
  try {
    [current, comparison] = await Promise.all([
      gsc.fetchDataset(client, currentRange),
      gsc.fetchDataset(client, comparisonRange),
    ]);
  } catch (error) {
    if (gsc.source !== "live") throw error;
    // The service account can't see this property (e.g. a demo client, or a
    // GSC user not added yet) — fall back to simulated data rather than fail.
    log(
      `Live GSC fetch failed for ${client.gsc_property_url} (${error instanceof Error ? error.message : error}); using simulated data for this client.`,
    );
    gsc = new MockGscAdapter(config);
    [current, comparison] = await Promise.all([
      gsc.fetchDataset(client, currentRange),
      gsc.fetchDataset(client, comparisonRange),
    ]);
  }
  log(
    `Current period: ${current.pages.length} pages, ${current.queries.length} queries. Comparison: ${comparison.pages.length} pages, ${comparison.queries.length} queries.`,
  );

  // --- Site totals -----------------------------------------------------------
  const siteCurrent = current.summary
    ? { clicks: current.summary.clicks, impressions: current.summary.impressions, ctr: current.summary.ctr, position: current.summary.position }
    : aggregateRows(current.pages);
  const sitePrevious = comparison.summary
    ? { clicks: comparison.summary.clicks, impressions: comparison.summary.impressions, ctr: comparison.summary.ctr, position: comparison.summary.position }
    : aggregateRows(comparison.pages);
  const site = {
    current: siteCurrent,
    previous: sitePrevious,
    comparison: compareMetricSets(siteCurrent, sitePrevious),
  };

  // --- Configured page performance -------------------------------------------
  const clientPages = config.clientPages.filter((p) => p.client_key === client.client_key && p.active);
  const pages: PagePerformance[] = clientPages.map((p) => {
    const cur = metricsForUrl(current.pages, p.url);
    const prev = metricsForUrl(comparison.pages, p.url);
    return {
      url: p.url,
      label: p.label,
      pageRole: p.page_role,
      contentType: p.content_type,
      commercialPriority: p.commercial_priority,
      current: cur,
      previous: prev,
      comparison: compareMetricSets(cur, prev),
    };
  });

  // Rest of site = every GSC page row not matching a configured page.
  const configuredUrls = new Set(clientPages.map((p) => normaliseUrl(p.url)));
  const restCurrentRows = current.pages.filter((r) => !configuredUrls.has(normaliseUrl(r.keys[0] ?? "")));
  const restPreviousRows = comparison.pages.filter((r) => !configuredUrls.has(normaliseUrl(r.keys[0] ?? "")));
  const restCurrent = restCurrentRows.length > 0 ? aggregateRows(restCurrentRows) : EMPTY_METRICS;
  const restPrevious = restPreviousRows.length > 0 ? aggregateRows(restPreviousRows) : EMPTY_METRICS;
  const restOfSite = {
    current: restCurrent,
    previous: restPrevious,
    comparison: compareMetricSets(restCurrent, restPrevious),
    pageCount: restCurrentRows.length,
  };

  // --- Groups, clusters, cannibalisation --------------------------------------
  const clientGroups = config.contentGroups.filter((g) => g.client_key === client.client_key);
  const clientGroupUrls = config.contentGroupUrls.filter((g) => g.client_key === client.client_key);
  const contentGroups = calculateContentGroups(clientGroups, clientGroupUrls, current.pages, comparison.pages);

  const clientClusters = config.topicClusters.filter((c) => c.client_key === client.client_key);
  const clientClusterRules = config.topicClusterRules.filter((c) => c.client_key === client.client_key);
  const topicClusters = calculateTopicClusters(clientClusters, clientClusterRules, current.queries, comparison.queries);

  const cannibalisation = findCannibalisation(current.queryPages, clientPages, {
    minImpressionsPerPage: 5,
    maxIssues: 40,
  });

  // --- Rankings -----------------------------------------------------------------
  const rankingProviders: RankingProvider[] = [];
  if (app.seRankingApiKey) rankingProviders.push(new SERankingProvider(app.seRankingApiKey));
  rankingProviders.push(new LocalCsvRankingProvider());
  rankingProviders.push(new SheetImportRankingProvider(config.rankingImports));
  const rankings = await resolveRankings(rankingProviders, client, period);
  log(`Rankings: ${rankings.keywordsTracked} tracked keywords via ${rankings.source}.`);

  // --- Findings (deterministic, always first) --------------------------------------
  const computation = {
    clientName: client.client_name,
    periodLabel: period.label,
    site,
    pages,
    restOfSite,
    contentGroups,
    topicClusters,
    cannibalisation,
    rankings,
  };
  const findings = buildFindings(computation);

  const kpis = buildKpis({ site, rankings });

  // --- Commentary (rules or LLM draft, then human overrides) ------------------------
  const drawTasks = config.drawTasks.filter(
    (t) => t.client_key === client.client_key && t.period_key === period.period_key,
  );
  const overrides = config.narrativeOverrides;
  const llmProvider = app.enableLlmCommentary
    ? createLlmProvider(app.anthropicApiKey, app.anthropicModel)
    : null;
  const commentary = await buildCommentary({
    findings,
    llmInput: {
      clientName: client.client_name,
      periodLabel: period.label,
      kpis,
      drawTasks: drawTasks.map((t) => ({ timing: t.timing, category: t.category, title: t.title })),
    },
    requestedMode: app.commentaryMode,
    llmProvider,
    overrides,
    clientKey: client.client_key,
    periodKey: period.period_key,
    log,
  });

  const strategicNotes = config.strategicNotes.filter(
    (n) => n.client_key === client.client_key && n.period_key === period.period_key && n.active,
  );

  // --- Snapshot ------------------------------------------------------------------------
  const snapshot: ReportSnapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataSource: gsc.source,
    client,
    period,
    kpis,
    metrics: {
      site,
      pages,
      restOfSite,
      contentGroups,
      topicClusters,
      cannibalisation,
      rankings,
    },
    findings,
    commentary,
    drawTasks,
    strategicNotes,
    raw: {
      gsc: { current, comparison },
      rankingImports: config.rankingImports.filter(
        (r) => r.client_key === client.client_key && r.period_key === period.period_key,
      ),
      rankingKeywords: config.rankingKeywords.filter((r) => r.client_key === client.client_key),
    },
    future: {
      conversions: null,
      ga4: null,
      aiSearch: {
        prompts: config.aiSearchPrompts.filter((p) => p.client_key === client.client_key),
        results: null,
      },
    },
  };

  const dir = path.join(REPORTS_DIR, client.client_key);
  fs.mkdirSync(dir, { recursive: true });
  const snapshotPath = path.join(dir, `${period.period_key}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  log(`Snapshot written to ${path.relative(process.cwd(), snapshotPath)}`);

  // --- Record in GeneratedReports (best effort; never fails the run) ---------------------
  try {
    const recorded = await recordGeneratedReport({
      client_key: client.client_key,
      period_key: period.period_key,
      generated_at: snapshot.generatedAt,
      snapshot_path: path.relative(process.cwd(), snapshotPath),
      dashboard_url: `${app.appUrl}/reports/${client.client_key}/${period.period_key}`,
      status: "generated",
    });
    if (recorded) log("GeneratedReports tab updated.");
  } catch (error) {
    log(`Could not update GeneratedReports tab: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { snapshot, snapshotPath };
}

/** Re-exported for scripts that need the config without generating. */
export { loadAdminConfig };
export type { AdminConfig, ClientRow, ReportPeriodRow };
// urlMatches re-exported so scripts can sanity-check group rules.
export { urlMatches };
