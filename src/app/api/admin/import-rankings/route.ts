import { NextResponse } from "next/server";
import { importRankingsCsvText } from "@/lib/adminActions";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const clientKey = String(form.get("clientKey") ?? "");
    const periodKey = String(form.get("periodKey") ?? "");
    const file = form.get("file");
    if (!clientKey || !periodKey || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, message: "Pick a client, a month, and a CSV file." },
        { status: 400 },
      );
    }
    const csvText = await file.text();
    const result = await importRankingsCsvText({ clientKey, periodKey, csvText });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Import failed." },
      { status: 500 },
    );
  }
}
