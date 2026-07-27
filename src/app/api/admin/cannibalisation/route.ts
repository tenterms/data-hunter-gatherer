import { NextResponse } from "next/server";
import { saveCannibalisationExclusions } from "@/lib/reportSettings";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveCannibalisationExclusions({
      clientKey: String(body.clientKey ?? ""),
      hiddenQueries: Array.isArray(body.hiddenQueries) ? body.hiddenQueries.map(String) : [],
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
