import { NextRequest, NextResponse } from "next/server";
import { loadAdminConfig } from "@/lib/sheets";
import { listSnapshots, readSnapshot } from "@/lib/snapshots";
import { seRankingSetupStatus } from "@/lib/seRankingSetup";

export const maxDuration = 60;

/**
 * Everything needed to draft a client's targeting plan, in one call:
 * what the site targets (master page list), what it earns (top GSC queries
 * and pages from the latest report snapshot), and what's already set up
 * (SE Ranking engines/groups/keywords, content groups, topic clusters,
 * key page roles). Consumed by the team's Claude workspace during keyword
 * research, then the resulting plan is pushed back through the existing
 * admin APIs (seranking-setup, import-groups, pages).
 */
export async function GET(request: NextRequest) {
  const clientKey = request.nextUrl.searchParams.get("clientKey") ?? "";
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) {
    return NextResponse.json(
      {
        ok: false,
        message: "Unknown client.",
        clients: config.clients.map((c) => ({ key: c.client_key, name: c.client_name, domain: c.domain })),
      },
      { status: 404 },
    );
  }

  const latest = listSnapshots().find((s) => s.clientKey === clientKey);
  const snapshot = latest ? readSnapshot(clientKey, latest.periodKey) : null;
  const topQueries = (snapshot?.raw.gsc.current.queries ?? [])
    .slice()
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 300)
    .map((r) => ({ query: r.keys[0] ?? "", clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 }));
  const topPages = (snapshot?.raw.gsc.current.pages ?? [])
    .slice()
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 100)
    .map((r) => ({ url: r.keys[0] ?? "", clicks: r.clicks, impressions: r.impressions }));

  const seRanking = await seRankingSetupStatus(clientKey);

  return NextResponse.json({
    ok: true,
    client: { key: client.client_key, name: client.client_name, domain: client.domain },
    gscPeriod: snapshot ? snapshot.period.label : null,
    masterPages: config.masterPages
      .filter((p) => p.client_key === clientKey && p.active)
      .map((p) => ({
        url: p.url,
        title: p.title,
        h1: p.h1,
        primaryKeyword: p.primary_keyword,
        intent: p.intent,
        section: p.section,
        closeGroup: p.close_group,
      })),
    keyPages: config.clientPages
      .filter((p) => p.client_key === clientKey && p.active)
      .map((p) => ({ url: p.url, label: p.label, role: p.page_role })),
    contentGroups: config.contentGroups
      .filter((g) => g.client_key === clientKey)
      .map((g) => ({
        key: g.group_key,
        name: g.group_name,
        rules: config.contentGroupUrls
          .filter((r) => r.client_key === clientKey && r.group_key === g.group_key)
          .map((r) => ({ match: r.match_type, url: r.url })),
      })),
    topicClusters: config.topicClusters
      .filter((t) => t.client_key === clientKey)
      .map((t) => ({
        key: t.topic_key,
        name: t.topic_name,
        rules: config.topicClusterRules
          .filter((r) => r.client_key === clientKey && r.topic_key === t.topic_key)
          .map((r) => ({ match: r.match_type, query: r.query_text })),
      })),
    seRanking: seRanking.ok
      ? {
          engines: seRanking.engines,
          groups: seRanking.groups,
          keywordCount: seRanking.keywordCount,
          keywords: seRanking.keywords,
        }
      : { error: seRanking.message },
    gsc: { topQueries, topPages },
  });
}
