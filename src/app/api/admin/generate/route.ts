import { NextResponse } from "next/server";
import { generateReport } from "@/lib/reportGenerator";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientKey = String(body.clientKey ?? "");
    const periodKey = String(body.periodKey ?? "");
    if (!clientKey || !periodKey) {
      return NextResponse.json({ ok: false, message: "clientKey and periodKey are required." }, { status: 400 });
    }
    const log: string[] = [];
    const { snapshot } = await generateReport({
      clientKey,
      periodKey,
      log: (m) => log.push(m),
    });
    return NextResponse.json({
      ok: true,
      message: `Report generated for ${snapshot.client.client_name} — ${snapshot.period.label} (${snapshot.dataSource} data).`,
      reportUrl: `/reports/${clientKey}/${periodKey}`,
      log,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Report generation failed." },
      { status: 500 },
    );
  }
}
