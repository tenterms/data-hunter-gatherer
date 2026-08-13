import fs from "fs";
import path from "path";
import crypto from "crypto";
import { google } from "googleapis";
import { DATA_DIR, getAppConfig } from "./config";
import { getGoogleAuth } from "./sheets";

/**
 * "Sign in with Google" for Search Console access.
 *
 * Instead of asking every client to add the service-account email to their
 * Search Console, the team signs in once with the agency Google account (which
 * already has access to client properties). Tokens live on the data volume and
 * refresh automatically; the service account remains as a fallback so existing
 * setups keep working.
 *
 * Needs a Google OAuth client (Web application) in the same Cloud project:
 * set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, with
 * {APP_URL}/api/google/callback as an authorized redirect URI.
 */

const AUTH_FILE = path.join(DATA_DIR, "google", "auth.json");

const AUTH_URL = process.env.GOOGLE_OAUTH_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"];

// ---------------------------------------------------------------------------
// Base URL (shared with the SEO Gets integration)
// ---------------------------------------------------------------------------

/**
 * The app's public base URL, taken from the request that's being served —
 * behind Railway's proxy the forwarded headers carry the real host, so this
 * works without any environment variable. NEXT_PUBLIC_APP_URL (when set to a
 * non-localhost value) still wins, for setups behind unusual proxies.
 */
export function publicBaseUrl(headers: Headers): string {
  const { appUrl } = getAppConfig();
  if (appUrl && !/localhost|127\.0\.0\.1/.test(appUrl)) return appUrl.replace(/\/+$/, "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  const proto = headers.get("x-forwarded-proto") ?? (/localhost|127\.0\.0\.1/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

interface StoredGoogleAuth {
  access_token: string;
  refresh_token: string;
  /** epoch ms */
  expires_at?: number;
  /** account the tokens belong to, decoded from the id_token */
  email?: string;
}

function readAuth(): StoredGoogleAuth | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as StoredGoogleAuth;
    return parsed.refresh_token ? parsed : null;
  } catch {
    return null;
  }
}

function writeAuth(auth: StoredGoogleAuth): void {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

export function disconnectGoogle(): void {
  try {
    fs.rmSync(AUTH_FILE);
  } catch {
    // already gone
  }
}

export function googleConnectStatus(): { connected: boolean; email?: string; configured: boolean } {
  const auth = readAuth();
  return {
    connected: auth !== null,
    email: auth?.email,
    configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  };
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

function oauthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google sign-in isn't configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (create an OAuth client in the Google Cloud project).",
    );
  }
  return { clientId, clientSecret };
}

export function buildGoogleAuthUrl(baseUrl: string): { url: string; state: string } {
  const { clientId } = oauthClient();
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl}/api/google/callback`,
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent so Google issues a refresh token we can keep using.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return { url: `${AUTH_URL}?${params.toString()}`, state };
}

function emailFromIdToken(idToken: string | undefined): string | undefined {
  try {
    if (!idToken) return undefined;
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Google token endpoint said ${res.status}: ${body.error ?? ""} ${body.error_description ?? ""}`.trim(),
    );
  }
  return body;
}

export async function exchangeGoogleCode(code: string, baseUrl: string): Promise<{ email?: string }> {
  const { clientId, clientSecret } = oauthClient();
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: `${baseUrl}/api/google/callback`,
  });
  if (!token.refresh_token) {
    throw new Error(
      "Google didn't return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.",
    );
  }
  const auth: StoredGoogleAuth = {
    access_token: token.access_token!,
    refresh_token: token.refresh_token,
    expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    email: emailFromIdToken(token.id_token),
  };
  writeAuth(auth);
  return { email: auth.email };
}

// ---------------------------------------------------------------------------
// Auth for API calls
// ---------------------------------------------------------------------------

/** True when the in-app Google connection is active. */
export function googleOAuthConnected(): boolean {
  return readAuth() !== null;
}

/**
 * Auth for Search Console calls: the in-app Google connection when the team
 * has signed in, otherwise the existing service-account / env credentials.
 */
export function getGscAuth() {
  const stored = readAuth();
  if (stored) {
    const { clientId, clientSecret } = oauthClient();
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: stored.refresh_token, access_token: stored.access_token });
    // Persist rotated access tokens so restarts don't re-refresh needlessly.
    oauth2.on("tokens", (tokens) => {
      const current = readAuth();
      if (!current) return;
      writeAuth({
        ...current,
        access_token: tokens.access_token ?? current.access_token,
        refresh_token: tokens.refresh_token ?? current.refresh_token,
        expires_at: tokens.expiry_date ?? current.expires_at,
      });
    });
    return oauth2;
  }
  try {
    return getGoogleAuth();
  } catch {
    throw new Error(
      "No Google Search Console access configured. Connect Google from the home page (Data sources), or set the service-account variables.",
    );
  }
}

/** List the GSC properties the connected account (or service account) can see. */
export async function listGscProperties(): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
  const api = google.searchconsole({ version: "v1", auth: getGscAuth() as never });
  const res = await api.sites.list();
  return (res.data.siteEntry ?? [])
    .filter((e) => e.siteUrl)
    .map((e) => ({ siteUrl: e.siteUrl!, permissionLevel: e.permissionLevel ?? "" }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}
