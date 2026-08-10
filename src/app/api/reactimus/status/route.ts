import { NextResponse } from "next/server";
import { setReactimusStatus } from "@/lib/reactimus";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await setReactimusStatus({
      clientKey: String(body.clientKey ?? ""),
      key: String(body.key ?? ""),
      status: String(body.status ?? ""),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Status update failed." },
      { status: 500 },
    );
  }
}
