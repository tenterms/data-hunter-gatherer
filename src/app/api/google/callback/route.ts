import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCode, publicBaseUrl } from "@/lib/googleAuth";

export async function GET(request: NextRequest) {
  const baseUrl = publicBaseUrl(request.headers);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get("google_oauth_state")?.value;
  const errorParam = request.nextUrl.searchParams.get("error");

  const back = (query: string) => {
    const res = NextResponse.redirect(`${baseUrl}/?${query}`);
    res.cookies.delete("google_oauth_state");
    return res;
  };

  if (errorParam) return back(`google=error&message=${encodeURIComponent(errorParam)}`);
  if (!code) return back("google=error&message=missing_code");
  if (!state || !storedState || state !== storedState) {
    return back("google=error&message=state_mismatch");
  }

  try {
    const { email } = await exchangeGoogleCode(code, baseUrl);
    return back(`google=connected${email ? `&account=${encodeURIComponent(email)}` : ""}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "token exchange failed";
    return back(`google=error&message=${encodeURIComponent(message)}`);
  }
}
