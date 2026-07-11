import type {
  CannibalisationIssue,
  CannibalisationPageBreakdown,
  ClientPageRow,
  GscRow,
  PriorityFlag,
} from "./types";
import { calcCtr, weightedAveragePosition } from "./metrics";

/**
 * Cannibalisation catcher.
 *
 * Uses query+page GSC data, keeps queries where more than one URL receives
 * impressions, and scores each issue so the worst problems float to the top:
 *  - high impressions, low clicks relative to impressions
 *  - more competing pages
 *  - primary/commercial configured pages involved
 *  - strong average position but weak CTR (ranking well, converting badly)
 */

interface PageMeta {
  pageRole: ClientPageRow["page_role"] | null;
  commercialPriority: ClientPageRow["commercial_priority"] | null;
}

function normaliseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function lookupPageMeta(url: string, pages: ClientPageRow[]): PageMeta {
  const target = normaliseUrl(url);
  const match = pages.find((p) => normaliseUrl(p.url) === target);
  return {
    pageRole: match?.page_role ?? null,
    commercialPriority: match?.commercial_priority ?? null,
  };
}

export function scoreCannibalisation(issue: {
  impressions: number;
  clicks: number;
  ctr: number;
  position: number | null;
  pageCount: number;
  importantPageCount: number;
}): number {
  let score = 0;

  // Scale of the opportunity: log so one huge query doesn't drown everything.
  score += Math.log10(Math.max(issue.impressions, 1)) * 10;

  // Wasted demand: impressions without clicks.
  if (issue.impressions >= 50 && issue.ctr < 0.01) score += 20;
  else if (issue.impressions >= 50 && issue.ctr < 0.03) score += 10;

  // More pages competing = messier problem.
  score += Math.min(issue.pageCount - 1, 4) * 8;

  // Primary/commercial pages tangled up in the same query.
  score += issue.importantPageCount * 15;

  // Good average position but poor CTR = the classic cannibalisation signature.
  if (issue.position !== null && issue.position <= 10 && issue.ctr < 0.02) score += 25;
  else if (issue.position !== null && issue.position <= 20 && issue.ctr < 0.01) score += 10;

  return Math.round(score * 10) / 10;
}

function flagFromScore(score: number): PriorityFlag {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function findCannibalisation(
  queryPageRows: GscRow[],
  clientPages: ClientPageRow[],
  options: { minImpressionsPerPage?: number; maxIssues?: number } = {},
): CannibalisationIssue[] {
  const minImpressions = options.minImpressionsPerPage ?? 1;
  const byQuery = new Map<string, GscRow[]>();

  for (const row of queryPageRows) {
    const [query] = row.keys;
    if (!query || row.impressions < minImpressions) continue;
    const list = byQuery.get(query);
    if (list) list.push(row);
    else byQuery.set(query, [row]);
  }

  const issues: CannibalisationIssue[] = [];

  for (const [query, rows] of byQuery) {
    // Only queries where more than one distinct URL receives impressions.
    const distinctUrls = new Set(rows.map((r) => normaliseUrl(r.keys[1] ?? "")));
    if (distinctUrls.size < 2) continue;

    const clicks = rows.reduce((sum, r) => sum + r.clicks, 0);
    const impressions = rows.reduce((sum, r) => sum + r.impressions, 0);
    const ctr = calcCtr(clicks, impressions);
    const position = weightedAveragePosition(rows);

    const pages: CannibalisationPageBreakdown[] = rows
      .map((r) => {
        const meta = lookupPageMeta(r.keys[1] ?? "", clientPages);
        return {
          url: r.keys[1] ?? "",
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: calcCtr(r.clicks, r.impressions),
          position: r.impressions > 0 ? r.position : null,
          pageRole: meta.pageRole,
          commercialPriority: meta.commercialPriority,
        };
      })
      .sort((a, b) => b.impressions - a.impressions);

    const importantPageCount = pages.filter(
      (p) => p.pageRole === "primary" || p.commercialPriority === "high",
    ).length;

    const priorityScore = scoreCannibalisation({
      impressions,
      clicks,
      ctr,
      position,
      pageCount: pages.length,
      importantPageCount,
    });

    issues.push({
      query,
      pageCount: distinctUrls.size,
      clicks,
      impressions,
      ctr,
      position,
      pages,
      priorityScore,
      priorityFlag: flagFromScore(priorityScore),
    });
  }

  issues.sort((a, b) => b.priorityScore - a.priorityScore);
  return options.maxIssues ? issues.slice(0, options.maxIssues) : issues;
}
