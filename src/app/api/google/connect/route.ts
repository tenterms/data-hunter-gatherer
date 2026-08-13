import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthUrl, publicBaseUrl } from "@/lib/googleAuth";

export async function GET(request: NextRequest) {
  try {
    const { url, state } = buildGoogleAuthUrl(publicBaseUrl(request.headers));
    const res = NextResponse.redirect(url);
    res.cookies.set("google_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return res;
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Something went wrong." },
      { status: 400 },
    );
  }
}
