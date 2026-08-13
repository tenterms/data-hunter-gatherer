import { NextResponse } from "next/server";
import { disconnectGoogle } from "@/lib/googleAuth";

export async function POST() {
  disconnectGoogle();
  return NextResponse.json({ ok: true, message: "Google disconnected. GSC falls back to the service account if configured." });
}
