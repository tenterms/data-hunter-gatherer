import { NextResponse } from "next/server";
import { createClient } from "@/lib/adminActions";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await createClient({
      clientName: String(body.clientName ?? ""),
      domain: String(body.domain ?? ""),
      gscPropertyUrl: body.gscPropertyUrl ? String(body.gscPropertyUrl) : undefined,
      firstMonth: body.firstMonth ? String(body.firstMonth) : undefined,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Something went wrong." },
      { status: 500 },
    );
  }
}
