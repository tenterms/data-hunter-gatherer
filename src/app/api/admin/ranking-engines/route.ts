import { NextResponse } from "next/server";
import { saveRankingEngines } from "@/lib/reportSettings";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveRankingEngines({
      clientKey: String(body.clientKey ?? ""),
      engines: Array.isArray(body.engines)
        ? body.engines.map((e: { id?: unknown; label?: unknown; active?: unknown }) => ({
            id: String(e.id ?? ""),
            label: String(e.label ?? ""),
            active: e.active !== false,
          }))
        : [],
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Save failed." },
      { status: 500 },
    );
  }
}
