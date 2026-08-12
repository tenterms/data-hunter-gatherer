import { NextResponse } from "next/server";
import { buildAuthorizeRedirect } from "@/lib/seogets";

/** Kick off the SEO Gets OAuth flow: remember the PKCE verifier, redirect to their consent page. */
export async function GET() {
  const { url, verifier } = buildAuthorizeRedirect();
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
