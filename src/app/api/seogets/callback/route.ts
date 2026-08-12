import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { exchangeAuthCode } from "@/lib/seogets";

/** OAuth redirect target: exchange the code for tokens, bounce back to admin. */
export async function GET(request: NextRequest) {
  const { appUrl } = getAppConfig();
  const back = (query: string) => NextResponse.redirect(`${appUrl.replace(/\/+$/, "")}/admin?${query}`);

  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return back(`seogets=error&detail=${encodeURIComponent(request.nextUrl.searchParams.get("error_description") ?? error)}`);
  }
  const code = request.nextUrl.searchParams.get("code");
  const verifier = request.cookies.get("seogets_verifier")?.value;
  if (!code || !verifier) {
    return back("seogets=error&detail=Missing%20code%20or%20verifier%20(try%20connecting%20again)");
  }
  try {
    await exchangeAuthCode(code, verifier);
  } catch (err) {
    return back(`seogets=error&detail=${encodeURIComponent((err as Error).message)}`);
  }
  const response = back("seogets=connected");
  response.cookies.delete("seogets_verifier");
  return response;
}
