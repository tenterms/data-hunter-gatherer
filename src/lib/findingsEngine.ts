import type {
  CannibalisationIssue,
  ComparedMetrics,
  Finding,
  Findings,
  GroupPerformance,
  MetricSet,
  PagePerformance,
  RankingSummary,
} from "./types";
import { formatChangePct, formatNumber, formatPct, formatPosition } from "./metrics";

/**
 * Deterministic findings engine.
 *
 * All important analysis happens here, in code. The output is a structured
 * findings object; commentary (rules-based or LLM) only puts words around
 * these facts and must never invent new ones.
 */

export interface ReportComputation {
  clientName: string;
  periodLabel: string;
  site: { current: MetricSet; previous: MetricSet; comparison: ComparedMetrics };
  pages: PagePerformance[];
  restOfSite: { current: MetricSet; previous: MetricSet; comparison: ComparedMetrics; pageCount: number };
  contentGroups: GroupPerformance[];
  topicClusters: GroupPerformance[];
  cannibalisation: CannibalisationIssue[];
  rankings: RankingSummary;
}

let counter = 0;
function finding(
  kind: string,
  sentiment: Finding["sentiment"],
  text: string,
  data?: Finding["data"],
): Finding {
  counter += 1;
  return { id: `${kind}_${counter}`, kind, sentiment, text, data };
}

function describeKpi(label: string, c: ComparedMetrics["clicks"], format: (n: number) => string): string {
  if (c.isNew) return `${label} rose from 0 to ${format(c.current)}.`;
  if (c.changePct === null || c.changePct === 0)
    return `${label} held flat at ${format(c.current)}.`;
  const direction = c.changePct > 0 ? "rose" : "fell";
  return `${label} ${direction} from ${format(c.previous)} to ${format(c.current)} (${formatChangePct(c)}).`;
}

export function buildFindings(input: ReportComputation): Findings {
  counter = 0;
  const executive: Finding[] = [];
  const traffic: Finding[] = [];
  const contentGroupFindings: Finding[] = [];
  const topicClusterFindings: Finding[] = [];
  const cannibalisationFindings: Finding[] = [];
  const rankingFindings: Finding[] = [];
  const strategic: Finding[] = [];

  const { site } = input;

  // --- Executive KPIs -------------------------------------------------------
  const clickSentiment =
    site.comparison.clicks.change > 0 ? "positive" : site.comparison.clicks.change < 0 ? "negative" : "neutral";
  executive.push(
    finding("clicks_change", clickSentiment, describeKpi("Total clicks", site.comparison.clicks, formatNumber), {
      current: site.current.clicks,
      previous: site.previous.clicks,
      changePct: site.comparison.clicks.changePct,
    }),
  );
  executive.push(
    finding(
      "impressions_change",
      site.comparison.impressions.change >= 0 ? "positive" : "negative",
      describeKpi("Total impressions", site.comparison.impressions, formatNumber),
      {
        current: site.current.impressions,
        previous: site.previous.impressions,
        changePct: site.comparison.impressions.changePct,
      },
    ),
  );
  executive.push(
    finding(
      "ctr_change",
      site.comparison.ctr.change >= 0 ? "positive" : "negative",
      `Site-wide click-through rate moved from ${formatPct(site.previous.ctr, 2)} to ${formatPct(site.current.ctr, 2)}.`,
      { current: site.current.ctr, previous: site.previous.ctr },
    ),
  );
  if (site.comparison.position.change !== null) {
    const improved = site.comparison.position.change < 0;
    executive.push(
      finding(
        "position_change",
        improved ? "positive" : site.comparison.position.change > 0.5 ? "negative" : "neutral",
        `Average position ${improved ? "improved" : "eased"} from ${formatPosition(site.previous.position)} to ${formatPosition(site.current.position)}. Site-wide average position blends every indexed query, so treat it as context rather than a target.`,
        { current: site.current.position, previous: site.previous.position },
      ),
    );
  }

  // --- Traffic: page movers --------------------------------------------------
  const activePages = [...input.pages].sort(
    (a, b) => Math.abs(b.comparison.clicks.change) - Math.abs(a.comparison.clicks.change),
  );
  for (const page of activePages.slice(0, 4)) {
    const c = page.comparison.clicks;
    if (c.change === 0) continue;
    traffic.push(
      finding(
        c.change > 0 ? "page_clicks_up" : "page_clicks_down",
        c.change > 0 ? "positive" : "negative",
        `${page.label} ${c.change > 0 ? "gained" : "lost"} clicks: ${formatNumber(c.previous)} → ${formatNumber(c.current)} (impressions ${formatNumber(page.comparison.impressions.previous)} → ${formatNumber(page.comparison.impressions.current)}).`,
        { url: page.url, role: page.pageRole, clicksChange: c.change },
      ),
    );
  }
  // Pages with high impressions but no clicks (opportunity)
  const wasted = input.pages
    .filter((p) => p.current.impressions >= 500 && p.current.clicks === 0)
    .sort((a, b) => b.current.impressions - a.current.impressions);
  for (const page of wasted.slice(0, 2)) {
    traffic.push(
      finding(
        "page_impressions_no_clicks",
        "warning",
        `${page.label} received ${formatNumber(page.current.impressions)} impressions but no clicks this period.`,
        { url: page.url, impressions: page.current.impressions },
      ),
    );
  }

  // --- Content groups ---------------------------------------------------------
  for (const group of input.contentGroups) {
    if (group.status === "flat") continue;
    contentGroupFindings.push(
      finding(
        `content_group_${group.status}`,
        group.status === "growing" ? "positive" : "negative",
        `Content group "${group.name}" is ${group.status}: clicks ${formatNumber(group.previous.clicks)} → ${formatNumber(group.current.clicks)} (${formatChangePct(group.comparison.clicks)}).`,
        { group: group.key, clicks: group.current.clicks, changePct: group.comparison.clicks.changePct },
      ),
    );
  }

  // --- Topic clusters ----------------------------------------------------------
  for (const cluster of input.topicClusters) {
    if (cluster.status === "flat") continue;
    topicClusterFindings.push(
      finding(
        `topic_cluster_${cluster.status}`,
        cluster.status === "growing" ? "positive" : "negative",
        `Topic cluster "${cluster.name}" is ${cluster.status}: clicks ${formatNumber(cluster.previous.clicks)} → ${formatNumber(cluster.current.clicks)}, impressions ${formatNumber(cluster.previous.impressions)} → ${formatNumber(cluster.current.impressions)}.`,
        { cluster: cluster.key, changePct: cluster.comparison.clicks.changePct },
      ),
    );
  }

  // --- Cannibalisation -----------------------------------------------------------
  const highPriority = input.cannibalisation.filter((i) => i.priorityFlag === "high");
  if (highPriority.length > 0) {
    cannibalisationFindings.push(
      finding(
        "cannibalisation_high_priority",
        "warning",
        `${highPriority.length} high-priority cannibalisation ${highPriority.length === 1 ? "issue" : "issues"} found where multiple pages compete for the same query.`,
        { count: highPriority.length },
      ),
    );
  }
  for (const issue of input.cannibalisation.slice(0, 3)) {
    cannibalisationFindings.push(
      finding(
        "cannibalisation_issue",
        issue.priorityFlag === "high" ? "warning" : "neutral",
        `"${issue.query}": ${issue.pageCount} pages share ${formatNumber(issue.impressions)} impressions for ${formatNumber(issue.clicks)} clicks (CTR ${formatPct(issue.ctr, 2)}, avg position ${formatPosition(issue.position)}).`,
        { query: issue.query, pages: issue.pageCount, score: issue.priorityScore },
      ),
    );
  }

  // --- Rankings --------------------------------------------------------------------
  const r = input.rankings;
  if (r.source === "unavailable" || r.keywordsTracked === 0) {
    rankingFindings.push(
      finding("rankings_unavailable", "neutral", "No tracked-keyword ranking data was available for this period.", {}),
    );
  } else {
    rankingFindings.push(
      finding(
        "rankings_balance",
        r.positionsUp >= r.positionsDown ? "positive" : "negative",
        `${r.positionsUp} tracked keyword positions improved and ${r.positionsDown} declined${r.entered > 0 ? `, with ${r.entered} new ${r.entered === 1 ? "entry" : "entries"}` : ""}${r.dropped > 0 ? ` and ${r.dropped} dropped out` : ""}.`,
        { up: r.positionsUp, down: r.positionsDown, entered: r.entered, dropped: r.dropped },
      ),
    );
    const top10Change = r.top10.current - r.top10.previous;
    rankingFindings.push(
      finding(
        "rankings_top_buckets",
        top10Change >= 0 ? "positive" : "negative",
        `Keywords in the top 3: ${r.top3.previous} → ${r.top3.current}; top 10: ${r.top10.previous} → ${r.top10.current}; top 30: ${r.top30.previous} → ${r.top30.current}.`,
        {
          top3: r.top3.current,
          top10: r.top10.current,
          top30: r.top30.current,
        },
      ),
    );
    for (const gain of r.notableGains.slice(0, 3)) {
      rankingFindings.push(
        finding(
          "ranking_gain",
          "positive",
          gain.direction === "entered"
            ? `"${gain.keyword}" entered the tracked set at position ${gain.endPosition}.`
            : `"${gain.keyword}" improved ${gain.change} place${gain.change === 1 ? "" : "s"} to position ${gain.endPosition}.`,
          { keyword: gain.keyword, end: gain.endPosition },
        ),
      );
    }
    for (const decline of r.notableDeclines.slice(0, 3)) {
      rankingFindings.push(
        finding(
          "ranking_decline",
          "negative",
          decline.direction === "dropped"
            ? `"${decline.keyword}" dropped out of the tracked positions (was ${decline.startPosition}).`
            : `"${decline.keyword}" slipped ${Math.abs(decline.change ?? 0)} place${Math.abs(decline.change ?? 0) === 1 ? "" : "s"} to position ${decline.endPosition}.`,
          { keyword: decline.keyword, end: decline.endPosition },
        ),
      );
    }
    if (r.visibilityScore !== null) {
      rankingFindings.push(
        finding("visibility_score", "neutral", `Tracked-set visibility score: ${r.visibilityScore}%.`, {
          visibility: r.visibilityScore,
        }),
      );
    }
  }

  // --- Strategic priority candidates -------------------------------------------------
  const decayingGroups = input.contentGroups.filter((g) => g.status === "decaying");
  if (decayingGroups.length > 0) {
    strategic.push(
      finding(
        "priority_decaying_groups",
        "warning",
        `Review the ${decayingGroups.map((g) => `"${g.name}"`).join(", ")} content ${decayingGroups.length === 1 ? "group" : "groups"} — clicks declined this period.`,
        { groups: decayingGroups.map((g) => g.key).join(",") },
      ),
    );
  }
  if (highPriority.length > 0) {
    strategic.push(
      finding(
        "priority_cannibalisation",
        "warning",
        `Resolve the high-priority cannibalisation issues (starting with "${highPriority[0].query}") by consolidating or differentiating the competing pages.`,
        { query: highPriority[0].query },
      ),
    );
  }
  for (const page of wasted.slice(0, 1)) {
    strategic.push(
      finding(
        "priority_ctr_gap",
        "neutral",
        `${page.label} earns impressions but converts none into clicks — review titles, meta descriptions and search intent fit.`,
        { url: page.url },
      ),
    );
  }
  const growingClusters = input.topicClusters.filter((c) => c.status === "growing");
  if (growingClusters.length > 0) {
    strategic.push(
      finding(
        "priority_build_on_growth",
        "positive",
        `Build on the momentum in ${growingClusters.map((c) => `"${c.name}"`).join(", ")} with supporting content.`,
        { clusters: growingClusters.map((c) => c.key).join(",") },
      ),
    );
  }
  if (r.notableDeclines.length > 0 && r.source !== "unavailable") {
    strategic.push(
      finding(
        "priority_ranking_declines",
        "warning",
        `Monitor the declining tracked keywords (e.g. "${r.notableDeclines[0].keyword}") and confirm whether the movement settles before making page changes.`,
        { keyword: r.notableDeclines[0].keyword },
      ),
    );
  }

  return {
    executive_findings: executive,
    traffic_findings: traffic,
    content_group_findings: contentGroupFindings,
    topic_cluster_findings: topicClusterFindings,
    cannibalisation_findings: cannibalisationFindings,
    ranking_findings: rankingFindings,
    strategic_priority_candidates: strategic,
  };
}
