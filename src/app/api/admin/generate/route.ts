import { NextRequest, NextResponse } from "next/server";
import { generateJobStatus, startGenerateJob } from "@/lib/generateJobs";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const clientKey = request.nextUrl.searchParams.get("clientKey") ?? "";
  const periodKey = request.nextUrl.searchParams.get("periodKey") ?? "";
  return NextResponse.json({ ok: true, job: generateJobStatus(clientKey, periodKey) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientKey = String(body.clientKey ?? "");
    const periodKey = String(body.periodKey ?? "");
    if (!clientKey || !periodKey) {
      return NextResponse.json({ ok: false, message: "clientKey and periodKey are required." }, { status: 400 });
    }
    const result = startGenerateJob(clientKey, periodKey);
    return NextResponse.json({ ...result, job: true }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Report generation failed." },
      { status: 500 },
    );
  }
}
