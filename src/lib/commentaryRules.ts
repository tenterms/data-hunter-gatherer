import type { CommentarySection, Finding, Findings } from "./types";

/**
 * Rules-based commentary: turns structured findings into plain British-English
 * paragraphs without any AI. This is the guaranteed fallback and the default
 * when no LLM key is configured.
 */

function sentences(findings: Finding[], max: number): string {
  return findings
    .slice(0, max)
    .map((f) => f.text)
    .join(" ");
}

function balanceLine(findings: Finding[]): string {
  const positives = findings.filter((f) => f.sentiment === "positive").length;
  const negatives = findings.filter((f) => f.sentiment === "negative" || f.sentiment === "warning").length;
  if (positives === 0 && negatives === 0) return "A quiet month with little meaningful movement.";
  if (positives > negatives) return "On balance this was a positive month.";
  if (negatives > positives) return "On balance this was a softer month.";
  return "A mixed month, with gains and declines roughly balancing out.";
}

export function generateRulesCommentary(findings: Findings): Record<CommentarySection, string> {
  const executive = [
    sentences(findings.executive_findings, 4),
    balanceLine([...findings.executive_findings, ...findings.ranking_findings]),
    findings.strategic_priority_candidates.length > 0
      ? `Suggested focus: ${findings.strategic_priority_candidates[0].text}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const traffic =
    findings.traffic_findings.length > 0
      ? sentences(findings.traffic_findings, 5)
      : "Page-level traffic was broadly stable this period, with no single page moving enough to call out.";

  const contentGroups =
    findings.content_group_findings.length > 0
      ? sentences(findings.content_group_findings, 5)
      : "Content group performance was broadly flat month on month.";

  const topicClusters =
    findings.topic_cluster_findings.length > 0
      ? sentences(findings.topic_cluster_findings, 5)
      : "Topic cluster performance was broadly flat month on month.";

  const cannibalisation =
    findings.cannibalisation_findings.length > 0
      ? sentences(findings.cannibalisation_findings, 4)
      : "No significant cannibalisation issues were detected this period.";

  const rankings =
    findings.ranking_findings.length > 0
      ? sentences(findings.ranking_findings, 6)
      : "No ranking data was available for this period.";

  const strategic =
    findings.strategic_priority_candidates.length > 0
      ? findings.strategic_priority_candidates.map((f, i) => `${i + 1}. ${f.text}`).join("\n")
      : "No data-driven priorities were flagged automatically this period — set priorities manually in the StrategicNotes sheet.";

  return {
    executive_summary: executive,
    traffic,
    content_groups: contentGroups,
    topic_clusters: topicClusters,
    cannibalisation,
    rankings,
    strategic_priorities: strategic,
  };
}
