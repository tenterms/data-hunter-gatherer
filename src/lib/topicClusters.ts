import type {
  GroupPerformance,
  GrowthMetric,
  GscRow,
  QueryMatchType,
  TopicClusterRow,
  TopicClusterRuleRow,
} from "./types";
import { aggregateRows, classifyGrowth, compareMetricSets } from "./metrics";

export function queryMatchesRule(
  query: string,
  ruleText: string,
  matchType: QueryMatchType,
  caseSensitive: boolean,
): boolean {
  if (ruleText.trim() === "") return false;
  const q = caseSensitive ? query : query.toLowerCase();
  const rule = caseSensitive ? ruleText : ruleText.toLowerCase();
  switch (matchType) {
    case "contains":
    case "not_contains": // negation is applied at cluster level, in clusterMatchesQuery
      return q.includes(rule);
    case "exact":
      return q === rule;
    case "regex":
      try {
        return new RegExp(ruleText, caseSensitive ? "" : "i").test(query);
      } catch {
        // An invalid regex in the sheet should not crash report generation.
        return false;
      }
  }
}

/**
 * SEOGets-style semantics: a query belongs to a cluster when it matches ANY
 * include rule (contains/exact/regex) and NONE of the "doesn't contain" rules.
 */
export function clusterMatchesQuery(query: string, rules: TopicClusterRuleRow[]): boolean {
  const active = rules.filter((r) => r.active);
  const includes = active.filter((r) => r.match_type !== "not_contains");
  const excludes = active.filter((r) => r.match_type === "not_contains");
  if (includes.length === 0) return false;
  if (!includes.some((r) => queryMatchesRule(query, r.query_text, r.match_type, r.case_sensitive))) {
    return false;
  }
  return !excludes.some((r) => queryMatchesRule(query, r.query_text, "contains", r.case_sensitive));
}

/**
 * Aggregate query-level GSC data into topic clusters. A query may match more
 * than one cluster (V1 behaviour, by design).
 */
export function calculateTopicClusters(
  clusters: TopicClusterRow[],
  rules: TopicClusterRuleRow[],
  currentQueries: GscRow[],
  previousQueries: GscRow[],
  growthMetric: GrowthMetric = "clicks",
): GroupPerformance[] {
  const results: GroupPerformance[] = [];

  for (const cluster of clusters) {
    if (!cluster.active) continue;
    const clusterRules = rules.filter(
      (r) => r.active && r.topic_key === cluster.topic_key && r.client_key === cluster.client_key,
    );
    if (clusterRules.filter((r) => r.match_type !== "not_contains").length === 0) continue;

    const matchRow = (row: GscRow) => clusterMatchesQuery(row.keys[0] ?? "", clusterRules);

    const currentRows = currentQueries.filter(matchRow);
    const previousRows = previousQueries.filter(matchRow);

    const current = aggregateRows(currentRows);
    const previous = aggregateRows(previousRows);
    const comparison = compareMetricSets(current, previous);

    results.push({
      key: cluster.topic_key,
      name: cluster.topic_name,
      description: cluster.description,
      current,
      previous,
      comparison,
      status: classifyGrowth(comparison, growthMetric),
      matchedRowCount: currentRows.length,
    });
  }

  results.sort((a, b) => b.current.clicks - a.current.clicks || b.current.impressions - a.current.impressions);
  return results;
}
