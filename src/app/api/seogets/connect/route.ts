import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeRedirect, publicBaseUrl } from "@/lib/seogets";

/** Kick off the SEO Gets OAuth flow: remember the PKCE verifier, redirect to their consent page. */
export async function GET(request: NextRequest) {
  const { url, verifier } = buildAuthorizeRedirect(publicBaseUrl(request.headers));
  const response = NextResponse.redirect(url);
  response.cookies.set("seogets_verifier", verifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
