import { NextResponse } from "next/server";
import { saveCannibalisationVisibility } from "@/lib/reportSettings";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveCannibalisationVisibility({
      clientKey: String(body.clientKey ?? ""),
      visibleQueries: Array.isArray(body.visibleQueries) ? body.visibleQueries.map(String) : [],
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
