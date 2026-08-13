import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * The Google OAuth flow against a stub token endpoint: auth-URL shape, the
 * code exchange (refresh token + email persisted), and disconnect.
 */

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "gauth-"));
process.env.DATA_DIR = tmpData;
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";

let server: http.Server;
let received: URLSearchParams | null = null;

function fakeIdToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return `header.${payload}.sig`;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received = new URLSearchParams(body);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "at-123",
          refresh_token: "rt-456",
          expires_in: 3599,
          id_token: fakeIdToken("seo@tenterms.com"),
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  process.env.GOOGLE_OAUTH_TOKEN_URL = `http://127.0.0.1:${port}/token`;
});

afterAll(() => {
  server.close();
  fs.rmSync(tmpData, { recursive: true, force: true });
});

describe("google oauth", () => {
  it("builds an auth url with offline access and the callback redirect", async () => {
    const { buildGoogleAuthUrl } = await import("@/lib/googleAuth");
    const { url, state } = buildGoogleAuthUrl("https://reports.tenterms.com");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://reports.tenterms.com/api/google/callback");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("scope")).toContain("webmasters.readonly");
    expect(parsed.searchParams.get("state")).toBe(state);
    expect(state.length).toBeGreaterThanOrEqual(16);
  });

  it("exchanges the code, stores tokens and decodes the account email", async () => {
    const { exchangeGoogleCode, googleConnectStatus, googleOAuthConnected } = await import("@/lib/googleAuth");
    const { email } = await exchangeGoogleCode("the-code", "https://reports.tenterms.com");
    expect(email).toBe("seo@tenterms.com");
    expect(received?.get("grant_type")).toBe("authorization_code");
    expect(received?.get("code")).toBe("the-code");
    expect(received?.get("client_secret")).toBe("test-secret");
    expect(received?.get("redirect_uri")).toBe("https://reports.tenterms.com/api/google/callback");

    const stored = JSON.parse(fs.readFileSync(path.join(tmpData, "google", "auth.json"), "utf8"));
    expect(stored.refresh_token).toBe("rt-456");
    expect(stored.email).toBe("seo@tenterms.com");

    expect(googleOAuthConnected()).toBe(true);
    const status = googleConnectStatus();
    expect(status.connected).toBe(true);
    expect(status.email).toBe("seo@tenterms.com");
  });

  it("disconnect removes the stored tokens", async () => {
    const { disconnectGoogle, googleOAuthConnected } = await import("@/lib/googleAuth");
    disconnectGoogle();
    expect(googleOAuthConnected()).toBe(false);
  });
});
