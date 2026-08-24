import { NextRequest, NextResponse } from "next/server";
import { aiPlatformAvailability, listAiVisibilityRuns, runAiVisibility, AI_PLATFORMS } from "@/lib/aiVisibility";
import { loadAdminConfig } from "@/lib/sheets";

// A full run is prompts x platforms live queries; give it room.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const clientKey = request.nextUrl.searchParams.get("clientKey") ?? "";
  const { config } = await loadAdminConfig();
  const prompts = config.aiSearchPrompts.filter((p) => p.client_key === clientKey && p.active);
  const runs = listAiVisibilityRuns(clientKey);
  const latest = runs[runs.length - 1];
  return NextResponse.json({
    ok: true,
    promptCount: prompts.length,
    platforms: AI_PLATFORMS.map((p) => ({ ...p, configured: aiPlatformAvailability()[p.id] })),
    runCount: runs.length,
    lastRunAt: latest?.ranAt ?? null,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runAiVisibility(String(body.clientKey ?? ""));
    return NextResponse.json(
      { ok: result.ok, message: result.message },
      { status: result.ok ? 200 : 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Run failed." },
      { status: 500 },
    );
  }
}
