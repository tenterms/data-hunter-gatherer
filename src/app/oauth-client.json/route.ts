import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/config";
import { clientMetadata } from "@/lib/seogets";

/**
 * OAuth client metadata document. SEO Gets (and any OAuth server supporting
 * client-ID metadata documents) identifies this app by fetching this URL, so
 * it must be publicly reachable — the middleware exempts it from the team
 * password gate.
 */
export async function GET() {
  const { appUrl } = getAppConfig();
  return NextResponse.json(clientMetadata(appUrl));
}
