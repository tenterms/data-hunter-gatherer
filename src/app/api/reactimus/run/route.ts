import { NextResponse } from "next/server";
import { runReactimus } from "@/lib/reactimus";

// A run pulls GSC data and fetches live pages, so it can take a minute.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const log: string[] = [];
    const result = await runReactimus(String(body.clientKey ?? ""), (m) => log.push(m));
    return NextResponse.json({ ...result, log }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Analysis failed." },
      { status: 500 },
    );
  }
}
