import type {
  ContentGroupRow,
  ContentGroupUrlRow,
  GroupPerformance,
  GrowthMetric,
  GscRow,
  UrlMatchType,
} from "./types";
import { aggregateRows, classifyGrowth, compareMetricSets, normaliseUrl } from "./metrics";

export function urlMatches(pageUrl: string, ruleUrl: string, matchType: UrlMatchType): boolean {
  const page = normaliseUrl(pageUrl);
  const rule = normaliseUrl(ruleUrl);
  if (rule === "") return false;
  switch (matchType) {
    case "exact":
      return page === rule;
    case "contains":
    case "not_contains": // negation applied at group level, in groupMatchesUrl
      return page.includes(rule);
    case "starts_with":
      return page.startsWith(rule);
  }
}

/**
 * SEOGets-style semantics: a URL belongs to a group when it matches ANY
 * include rule (exact/contains/starts_with) and NONE of the "doesn't contain"
 * rules.
 */
export function groupMatchesUrl(url: string, rules: ContentGroupUrlRow[]): boolean {
  const active = rules.filter((r) => r.active);
  const includes = active.filter((r) => r.match_type !== "not_contains");
  const excludes = active.filter((r) => r.match_type === "not_contains");
  if (includes.length === 0) return false;
  if (!includes.some((r) => urlMatches(url, r.url, r.match_type))) return false;
  return !excludes.some((r) => urlMatches(url, r.url, "contains"));
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
    if (rules.filter((r) => r.match_type !== "not_contains").length === 0) continue;

    const matchRow = (row: GscRow) => groupMatchesUrl(row.keys[0] ?? "", rules);

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
