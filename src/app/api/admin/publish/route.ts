import { NextResponse } from "next/server";
import { publishReport, unpublishReport } from "@/lib/publish";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await publishReport(String(body.clientKey ?? ""), String(body.periodKey ?? ""));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Publish failed." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const result = await unpublishReport(String(body.clientKey ?? ""), String(body.periodKey ?? ""));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Unpublish failed." },
      { status: 500 },
    );
  }
}
