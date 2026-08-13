import { NextResponse } from "next/server";
import { applyTargeting } from "@/lib/applyTargeting";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await applyTargeting(String(body.clientKey ?? ""));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Apply failed." },
      { status: 500 },
    );
  }
}
