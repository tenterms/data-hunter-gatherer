import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { loadAdminConfig } from "@/lib/sheets";
import { SERankingProvider } from "@/lib/rankings";

/** Live SE Ranking connection test for one client (admin panel button). */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientKey = String(body.clientKey ?? "");
    const app = getAppConfig();
    if (!app.seRankingApiKey) {
      return NextResponse.json({
        ok: false,
        message: "SERANKING_API_KEY is not set on the server, so live rankings are off.",
        lines: [],
      });
    }
    const { config } = await loadAdminConfig();
    const client = config.clients.find((c) => c.client_key === clientKey);
    if (!client) {
      return NextResponse.json({ ok: false, message: "Unknown client.", lines: [] }, { status: 404 });
    }
    const period = config.reportPeriods
      .filter((p) => p.client_key === clientKey)
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    if (!period) {
      return NextResponse.json({ ok: false, message: "Add a report month first.", lines: [] });
    }
    const lines = await new SERankingProvider(app.seRankingApiKey).probe(client, period);
    const ok = !lines.some((l) => l.startsWith("✗"));
    return NextResponse.json({
      ok,
      message: ok ? "SE Ranking connection looks good." : "SE Ranking test found problems — details below.",
      lines,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Test failed.", lines: [] },
      { status: 500 },
    );
  }
}
