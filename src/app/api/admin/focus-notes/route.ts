import { NextResponse } from "next/server";
import { saveFocusNotes } from "@/lib/focusNotes";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveFocusNotes({
      clientKey: String(body.clientKey ?? ""),
      periodKey: String(body.periodKey ?? ""),
      notes: String(body.notes ?? ""),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
