import { NextResponse } from "next/server";
import { addReactimusToReport } from "@/lib/reactimus";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await addReactimusToReport({
      clientKey: String(body.clientKey ?? ""),
      key: String(body.key ?? ""),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Add failed." },
      { status: 500 },
    );
  }
}
