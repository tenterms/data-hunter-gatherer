import { NextResponse } from "next/server";
import { pullSeoGetsGroups } from "@/lib/seogets";

// Discovery + several MCP calls can take a while.
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await pullSeoGetsGroups(String(body.clientKey ?? ""));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "SEO Gets pull failed.", warnings: [], debug: { tools: [], calls: [] } },
      { status: 500 },
    );
  }
}
