import { NextResponse } from "next/server";
import { saveDrawCell } from "@/lib/drawCell";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveDrawCell({
      clientKey: String(body.clientKey ?? ""),
      periodKey: String(body.periodKey ?? ""),
      timing: String(body.timing ?? ""),
      category: String(body.category ?? ""),
      text: String(body.text ?? ""),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
