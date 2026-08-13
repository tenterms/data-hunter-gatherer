import { NextResponse, type NextRequest } from "next/server";

/**
 * Team password gate. When APP_PASSWORD is set, everything except the client
 * share views (/share/...) and the login flow requires the team cookie.
 * Client share links are public but unguessable (32-hex-char tokens).
 */

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) return NextResponse.next(); // no gate configured (local dev)

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/share/") ||
    pathname === "/login" ||
    pathname === "/api/login" ||
    // OAuth surface for the SEO Gets connection: the metadata document is
    // fetched by their server, and the callback arrives from their redirect.
    pathname === "/oauth-client.json" ||
    pathname === "/api/seogets/callback" ||
    // Google OAuth return leg (state cookie is validated in the route).
    pathname === "/api/google/callback" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico";
  if (isPublic) return NextResponse.next();

  const cookie = request.cookies.get("team_auth")?.value;
  if (cookie && cookie === (await sha256Hex(appPassword))) return NextResponse.next();

  // Machine access for API routes: a separate revocable token (used by the
  // team's Claude workspace to run setup/imports without the human password).
  const apiToken = process.env.ADMIN_API_TOKEN;
  if (apiToken && pathname.startsWith("/api/")) {
    const header = request.headers.get("authorization") ?? "";
    if (header === `Bearer ${apiToken}`) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
