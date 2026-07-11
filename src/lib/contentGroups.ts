import type {
  ContentGroupRow,
  ContentGroupUrlRow,
  GroupPerformance,
  GrowthMetric,
  GscRow,
  UrlMatchType,
} from "./types";
import { aggregateRows, classifyGrowth, compareMetricSets } from "./metrics";

/** Normalise URLs enough that trailing-slash differences don't break matching. */
function normaliseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function urlMatches(pageUrl: string, ruleUrl: string, matchType: UrlMatchType): boolean {
  const page = normaliseUrl(pageUrl);
  const rule = normaliseUrl(ruleUrl);
  if (rule === "") return false;
  switch (matchType) {
    case "exact":
      return page === rule;
    case "contains":
      return page.includes(rule);
    case "starts_with":
      return page.startsWith(rule);
  }
}

/**
 * Aggregate page-level GSC data into the configured content groups for both
 * periods and classify each group as growing/decaying/flat.
 */
export function calculateContentGroups(
  groups: ContentGroupRow[],
  groupUrls: ContentGroupUrlRow[],
  currentPages: GscRow[],
  previousPages: GscRow[],
  growthMetric: GrowthMetric = "clicks",
): GroupPerformance[] {
  const results: GroupPerformance[] = [];

  for (const group of groups) {
    if (!group.active) continue;
    const rules = groupUrls.filter(
      (r) => r.active && r.group_key === group.group_key && r.client_key === group.client_key,
    );
    if (rules.length === 0) continue;

    const matchRow = (row: GscRow) =>
      rules.some((rule) => urlMatches(row.keys[0] ?? "", rule.url, rule.match_type));

    const currentRows = currentPages.filter(matchRow);
    const previousRows = previousPages.filter(matchRow);

    const current = aggregateRows(currentRows);
    const previous = aggregateRows(previousRows);
    const comparison = compareMetricSets(current, previous);

    results.push({
      key: group.group_key,
      name: group.group_name,
      description: group.description,
      current,
      previous,
      comparison,
      status: classifyGrowth(comparison, growthMetric),
      matchedRowCount: currentRows.length,
    });
  }

  // Biggest groups first, matching the reference UI.
  results.sort((a, b) => b.current.clicks - a.current.clicks || b.current.impressions - a.current.impressions);
  return results;
}
