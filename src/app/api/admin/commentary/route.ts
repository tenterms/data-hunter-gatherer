import { NextResponse } from "next/server";
import { saveCommentaryOverride } from "@/lib/commentaryEdit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveCommentaryOverride({
      clientKey: String(body.clientKey ?? ""),
      periodKey: String(body.periodKey ?? ""),
      section: String(body.section ?? ""),
      overrideText: String(body.overrideText ?? ""),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
