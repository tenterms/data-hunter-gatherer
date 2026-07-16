import { NextResponse } from "next/server";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return NextResponse.json({ ok: true, message: "No password is configured — you're already in." });
  }
  const body = await request.json().catch(() => ({}));
  const supplied = String(body.password ?? "");
  if (supplied !== appPassword) {
    return NextResponse.json({ ok: false, message: "Wrong password." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true, message: "Welcome back." });
  response.cookies.set("team_auth", await sha256Hex(appPassword), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return response;
}
