import type {
  Comparison,
  ComparedMetrics,
  GrowthMetric,
  GrowthStatus,
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
