import { NextResponse } from "next/server";
import { saveUrlExclusions } from "@/lib/reportSettings";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveUrlExclusions({
      clientKey: String(body.clientKey ?? ""),
      patterns: Array.isArray(body.patterns) ? body.patterns.map((p: unknown) => String(p ?? "")) : [],
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
