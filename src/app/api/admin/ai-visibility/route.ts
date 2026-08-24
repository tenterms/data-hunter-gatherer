import { NextRequest, NextResponse } from "next/server";
import { aiPlatformAvailability, aiVisibilityProgress, listAiVisibilityRuns, startAiVisibilityRun, AI_PLATFORMS } from "@/lib/aiVisibility";
import { loadAdminConfig } from "@/lib/sheets";

export const maxDuration = 30;

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
    progress: aiVisibilityProgress(clientKey),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = startAiVisibilityRun(String(body.clientKey ?? ""));
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
