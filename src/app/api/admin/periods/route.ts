import { NextResponse } from "next/server";
import { addPeriod } from "@/lib/adminActions";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await addPeriod({
      clientKey: String(body.clientKey ?? ""),
      month: String(body.month ?? ""),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Something went wrong." },
      { status: 500 },
    );
  }
}
