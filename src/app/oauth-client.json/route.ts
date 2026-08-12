import { NextRequest, NextResponse } from "next/server";
import { clientMetadata, publicBaseUrl } from "@/lib/seogets";

/**
 * OAuth client metadata document. SEO Gets (and any OAuth server supporting
 * client-ID metadata documents) identifies this app by fetching this URL, so
 * it must be publicly reachable — the middleware exempts it from the team
 * password gate. The URLs inside are derived from the request's own host so
 * they always match the domain the document is served from.
 */
export async function GET(request: NextRequest) {
  return NextResponse.json(clientMetadata(publicBaseUrl(request.headers)));
}
