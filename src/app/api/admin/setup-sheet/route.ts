import { NextResponse } from "next/server";
import { runSetupSheet } from "@/lib/adminActions";

export async function POST() {
  try {
    const result = await runSetupSheet();
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Sheet setup failed." },
      { status: 500 },
    );
  }
}
