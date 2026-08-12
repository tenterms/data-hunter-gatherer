import { NextResponse } from "next/server";
import { addKeywordGroup, addKeywords, addSearchEngine, seRankingSetupStatus } from "@/lib/seRankingSetup";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientKey = String(body.clientKey ?? "");
    switch (body.action) {
      case "status":
        return NextResponse.json(await seRankingSetupStatus(clientKey));
      case "add_engine": {
        const result = await addSearchEngine({
          clientKey,
          searchEngineId: String(body.searchEngineId ?? ""),
          regionName: body.regionName ? String(body.regionName) : undefined,
        });
        return NextResponse.json(result, { status: result.ok ? 200 : 400 });
      }
      case "add_group": {
        const result = await addKeywordGroup({ clientKey, name: String(body.name ?? "") });
        return NextResponse.json(result, { status: result.ok ? 200 : 400 });
      }
      case "add_keywords": {
        const result = await addKeywords({
          clientKey,
          keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
          groupId: body.groupId ? String(body.groupId) : undefined,
          targetUrl: body.targetUrl ? String(body.targetUrl) : undefined,
        });
        return NextResponse.json(result, { status: result.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "SE Ranking setup failed." },
      { status: 500 },
    );
  }
}
