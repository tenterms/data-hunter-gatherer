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
    if (clusterRules.length === 0) continue;

    const matchRow = (row: GscRow) =>
      clusterRules.some((rule) =>
        queryMatchesRule(row.keys[0] ?? "", rule.query_text, rule.match_type, rule.case_sensitive),
      );

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
