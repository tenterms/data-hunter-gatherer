import { NextResponse } from "next/server";
import { previewMatches } from "@/lib/groupEditor";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const kind = body.kind === "topic" || body.kind === "content" ? body.kind : null;
    if (!kind) return NextResponse.json({ ok: false, message: "Invalid group kind." }, { status: 400 });
    const result = await previewMatches({
      clientKey: String(body.clientKey ?? ""),
      kind,
      contains: Array.isArray(body.contains) ? body.contains.map(String) : [],
      notContains: Array.isArray(body.notContains) ? body.notContains.map(String) : [],
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Preview failed." },
      { status: 500 },
    );
  }
}
