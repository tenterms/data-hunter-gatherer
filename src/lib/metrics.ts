import type {
  Comparison,
  ComparedMetrics,
  GrowthMetric,
  GrowthStatus,
  GscDataset,
  GscRow,
  MetricSet,
} from "./types";

/**
 * Core metric calculations. Everything here is deterministic and unit-tested;
 * no LLM is involved in any numeric analysis.
 */

/**
 * Canonical URL form for matching tracked pages against GSC rows. Protocol,
 * "www." and trailing slashes are presentation details a client's config and
 * Search Console routinely disagree on (a site set up as knightsbridgecircle.com
 * reports in GSC as www.knightsbridgecircle.com), and every such mismatch used
 * to render a page's traffic as zero.
 */
export function normaliseUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/**
 * Strip every page whose URL contains one of the patterns (case-insensitive)
 * out of a GSC dataset, so a URL the team excludes (say a statistics post
 * hoovering up irrelevant queries) disappears from the report's numbers:
 *  - page rows and query+page rows matching a pattern are dropped
 *  - each query row loses exactly the clicks/impressions its excluded pages
 *    contributed (from the query+page rows), and vanishes if nothing is left
 *  - the summary is reduced by the excluded pages' totals, with the average
 *    position recomputed from the remaining pages
 */
export function excludeUrlsFromDataset(data: GscDataset, patterns: string[]): GscDataset {
  const needles = patterns.map((p) => p.trim().toLowerCase()).filter((p) => p !== "");
  if (needles.length === 0) return data;
  const excluded = (url: string) => {
    const u = url.toLowerCase();
    return needles.some((n) => u.includes(n));
  };

  const pages = data.pages.filter((r) => !excluded(r.keys[0] ?? ""));
  const removedPages = data.pages.filter((r) => excluded(r.keys[0] ?? ""));
  const queryPages = data.queryPages.filter((r) => !excluded(r.keys[1] ?? ""));

  const removedPerQuery = new Map<string, { clicks: number; impressions: number }>();
  for (const row of data.queryPages) {
    if (!excluded(row.keys[1] ?? "")) continue;
    const key = row.keys[0] ?? "";
    const agg = removedPerQuery.get(key) ?? { clicks: 0, impressions: 0 };
    agg.clicks += row.clicks;
    agg.impressions += row.impressions;
    removedPerQuery.set(key, agg);
  }
  const queries = data.queries
    .map((row) => {
      const removed = removedPerQuery.get(row.keys[0] ?? "");
      if (!removed) return row;
      const clicks = Math.max(0, row.clicks - removed.clicks);
      const impressions = Math.max(0, row.impressions - removed.impressions);
      return { ...row, clicks, impressions, ctr: calcCtr(clicks, impressions) };
    })
    .filter((row) => row.impressions > 0 || row.clicks > 0);

  let summary = data.summary;
  if (summary && removedPages.length > 0) {
    const clicks = Math.max(0, summary.clicks - removedPages.reduce((s, r) => s + r.clicks, 0));
    const impressions = Math.max(
      0,
      summary.impressions - removedPages.reduce((s, r) => s + r.impressions, 0),
    );
    summary = {
      ...summary,
      clicks,
      impressions,
      ctr: calcCtr(clicks, impressions),
      position: weightedAveragePosition(pages) ?? summary.position,
    };
  }

  return { summary, pages, queries, queryPages };
}

export function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

export function calcCtr(clicks: number, impressions: number): number {
  return safeDivide(clicks, impressions);
}

/**
 * Impression-weighted average position:
 *   sum(position * impressions) / sum(impressions)
 * Returns null when there are no impressions at all.
 */
export function weightedAveragePosition(
  rows: Array<{ position: number; impressions: number }>,
): number | null {
  let weighted = 0;
  let impressions = 0;
  for (const row of rows) {
    if (row.impressions > 0) {
      weighted += row.position * row.impressions;
      impressions += row.impressions;
    }
  }
  if (impressions === 0) return null;
  return weighted / impressions;
}

export function aggregateRows(rows: GscRow[]): MetricSet {
  let clicks = 0;
  let impressions = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: calcCtr(clicks, impressions),
    position: weightedAveragePosition(rows),
  };
}

export const EMPTY_METRICS: MetricSet = { clicks: 0, impressions: 0, ctr: 0, position: null };

/**
 * Compare two values. Percentage-change rules:
 *  - previous 0, current 0  -> changePct 0
 *  - previous 0, current >0 -> changePct null, isNew true (never Infinity)
 */
export function compareValues(current: number, previous: number): Comparison {
  const change = current - previous;
  let changePct: number | null;
  let isNew = false;
  if (previous === 0) {
    if (current === 0) {
      changePct = 0;
    } else {
      changePct = null;
      isNew = true;
    }
  } else {
    changePct = change / previous;
  }
  return { current, previous, change, changePct, isNew };
}

export function compareMetricSets(current: MetricSet, previous: MetricSet): ComparedMetrics {
  return {
    clicks: compareValues(current.clicks, previous.clicks),
    impressions: compareValues(current.impressions, previous.impressions),
    ctr: compareValues(current.ctr, previous.ctr),
    position: {
      current: current.position,
      previous: previous.position,
      change:
        current.position !== null && previous.position !== null
          ? current.position - previous.position
          : null,
    },
  };
}

/**
 * Classify growth for the All/Growing/Decaying filters. Default growth metric
 * is clicks. A ±5% band counts as flat; tiny absolute movement (<2 clicks or
 * <20 impressions) also counts as flat so noise doesn't get labelled a trend.
 */
export function classifyGrowth(
  comparison: ComparedMetrics,
  metric: GrowthMetric = "clicks",
  flatBandPct = 0.05,
): GrowthStatus {
  const c = comparison[metric];
  const minAbsChange = metric === "clicks" ? 2 : 20;
  if (Math.abs(c.change) < minAbsChange) return "flat";
  if (c.isNew) return "growing";
  if (c.changePct === null || c.changePct === 0) return "flat";
  if (c.changePct > flatBandPct) return "growing";
  if (c.changePct < -flatBandPct) return "decaying";
  return "flat";
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by rules commentary and the dashboard)
// ---------------------------------------------------------------------------

export function formatNumber(n: number): string {
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString("en-GB");
}

export function formatPct(fraction: number | null, decimals = 1): string {
  if (fraction === null) return "new";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function formatChangePct(comparison: Comparison): string {
  if (comparison.isNew) return "new";
  if (comparison.changePct === null) return "–";
  const pct = comparison.changePct * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatPosition(position: number | null): string {
  if (position === null) return "–";
  return position.toFixed(1);
}
