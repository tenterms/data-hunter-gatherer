import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA_DIR, getAppConfig } from "./config";
import { loadAdminConfig } from "./sheets";
import { proxyAwareFetch } from "@/reactimus/content/httpClient";

/**
 * SEO Gets integration, over their MCP endpoint (https://app.seogets.com/mcp).
 *
 * Auth is OAuth (authorization code + PKCE, public client). SEO Gets requires
 * the client to be identified by a hosted client-metadata document, so the app
 * serves its own at {APP_URL}/oauth-client.json and uses that URL as the
 * client_id. The team connects once from the admin UI; tokens live on the data
 * volume and refresh automatically.
 *
 * The MCP surface is discovered at call time (tools/list) rather than
 * hardcoded, so the pull endpoint reports exactly what the server offers and
 * the mapping can be tuned against real payloads.
 */

const MCP_URL = "https://app.seogets.com/mcp";
const AUTH_URL = "https://app.seogets.com/mcp/oauth/authorize";
const TOKEN_URL = "https://app.seogets.com/mcp/oauth/token";
const SCOPE = "mcp:read";

const AUTH_FILE = path.join(DATA_DIR, "seogets", "auth.json");

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

interface StoredAuth {
  access_token: string;
  refresh_token?: string;
  /** epoch ms */
  expires_at?: number;
  /** the client_id (metadata URL) the tokens were issued to — needed on refresh */
  client_id?: string;
}

function readAuth(): StoredAuth | null {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as StoredAuth;
  } catch {
    return null;
  }
}

function writeAuth(auth: StoredAuth): void {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

export function seoGetsConnected(): boolean {
  return readAuth() !== null;
}

export function disconnectSeoGets(): void {
  try {
    fs.rmSync(AUTH_FILE);
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// OAuth (authorization code + PKCE, client identified by metadata URL)
// ---------------------------------------------------------------------------

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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

export function clientMetadata(appUrl: string) {
  const base = appUrl.replace(/\/+$/, "");
  return {
    client_id: `${base}/oauth-client.json`,
    client_name: "TenTerms Reporting",
    client_uri: base,
    redirect_uris: [`${base}/api/seogets/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPE,
  };
}

export function buildAuthorizeRedirect(baseUrl: string): { url: string; verifier: string } {
  const meta = clientMetadata(baseUrl);
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({
    response_type: "code",
    client_id: meta.client_id,
    redirect_uri: meta.redirect_uris[0],
    scope: SCOPE,
    state: b64url(crypto.randomBytes(12)),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { url: `${AUTH_URL}?${params}`, verifier };
}

export async function exchangeAuthCode(code: string, verifier: string, baseUrl: string): Promise<void> {
  const meta = clientMetadata(baseUrl);
  const res = await proxyAwareFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: meta.redirect_uris[0],
      client_id: meta.client_id,
      code_verifier: verifier,
    }).toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Token exchange failed (HTTP ${res.status}).`);
  }
  writeAuth({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + (data.expires_in - 60) * 1000 : undefined,
    client_id: meta.client_id,
  });
}

async function getAccessToken(): Promise<string> {
  const auth = readAuth();
  if (!auth) throw new Error("SEO Gets is not connected — use the Connect button in admin first.");
  if (!auth.expires_at || auth.expires_at > Date.now()) return auth.access_token;
  if (!auth.refresh_token) return auth.access_token; // let the server tell us if it's expired

  const res = await proxyAwareFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refresh_token,
      client_id: auth.client_id ?? clientMetadata(getAppConfig().appUrl).client_id,
    }).toString(),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!res.ok || !data.access_token) {
    throw new Error("SEO Gets session expired — reconnect from the admin page.");
  }
  const next: StoredAuth = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? auth.refresh_token,
    expires_at: data.expires_in ? Date.now() + (data.expires_in - 60) * 1000 : undefined,
    client_id: auth.client_id,
  };
  writeAuth(next);
  return next.access_token;
}

// ---------------------------------------------------------------------------
// Minimal MCP client (streamable HTTP)
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Parse a streamable-HTTP response body: plain JSON or an SSE stream. */
async function parseMcpBody(res: Response): Promise<JsonRpcResponse[]> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (contentType.includes("text/event-stream")) {
    const messages: JsonRpcResponse[] = [];
    for (const chunk of text.split(/\n\n+/)) {
      const dataLines = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      try {
        messages.push(JSON.parse(dataLines.join("")) as JsonRpcResponse);
      } catch {
        // ignore non-JSON keep-alives
      }
    }
    return messages;
  }
  if (!text.trim()) return [];
  const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

class McpClient {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(private token: string) {}

  private async post(body: Record<string, unknown>): Promise<{ res: Response; messages: JsonRpcResponse[] }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const res = await proxyAwareFetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const messages = await parseMcpBody(res as unknown as Response);
    return { res: res as unknown as Response, messages };
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const { res, messages } = await this.post({ jsonrpc: "2.0", id, method, params: params ?? {} });
    if (res.status === 401) throw new Error("SEO Gets rejected the connection (401) — reconnect from the admin page.");
    const reply = messages.find((m) => m.id === id);
    if (!reply) throw new Error(`SEO Gets MCP returned no response to ${method} (HTTP ${res.status}).`);
    if (reply.error) throw new Error(`SEO Gets MCP error on ${method}: ${reply.error.message}`);
    return reply.result;
  }

  async connect(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "tenterms-reporting", version: "1.0" },
    });
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
    const result = (await this.request("tools/list")) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    };
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = (result.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
    if (result.isError) throw new Error(`SEO Gets tool "${name}" failed: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

export async function seoGetsClient(): Promise<McpClient> {
  const token = await getAccessToken();
  const client = new McpClient(token);
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// Pull + mapping
// ---------------------------------------------------------------------------

export interface ImportGroupItem {
  name: string;
  contains: string[];
  notContains: string[];
  description?: string;
}

export interface SeoGetsPullResult {
  ok: boolean;
  message: string;
  proposal?: { contentGroups: ImportGroupItem[]; topicClusters: ImportGroupItem[] };
  warnings: string[];
  /** what the MCP server offered / returned, for debugging the mapping */
  debug: { tools: string[]; calls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> };
}

const norm = (s: string) => s.toLowerCase().replace(/^www\./, "");

/** Extract string-array fields from an unknown group-ish object. */
function stringArrays(obj: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) {
      out[key] = value as string[];
    }
  }
  return out;
}

function groupName(obj: Record<string, unknown>): string {
  for (const key of ["name", "group_name", "groupName", "title", "label"]) {
    if (typeof obj[key] === "string" && (obj[key] as string).trim()) return (obj[key] as string).trim();
  }
  return "";
}

/** Find arrays of group-like objects anywhere in a tool result. */
function findGroupObjects(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 4 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    const objs = value.filter(
      (v): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && groupName(v as Record<string, unknown>) !== "",
    );
    if (objs.length > 0) return objs;
    return value.flatMap((v) => findGroupObjects(v, depth + 1));
  }
  return Object.values(value as Record<string, unknown>).flatMap((v) => findGroupObjects(v, depth + 1));
}

/** URL fragment -> query phrase ("cyber-security" -> "cyber security"). */
const patternToQuery = (p: string) =>
  p
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Query phrase -> URL fragment ("cyber security" -> "cyber-security"). */
const queryToPattern = (q: string) => q.trim().toLowerCase().replace(/\s+/g, "-");

/**
 * Derive the missing kind from the populated one, 1:1 by name, flagging
 * anything that doesn't translate cleanly so a human can check it.
 */
export function deriveCounterpart(
  items: ImportGroupItem[],
  from: "content" | "topic",
  clientName: string,
  warnings: string[],
): ImportGroupItem[] {
  const brandTokens = new Set(
    clientName
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
  return items.map((item) => {
    const converted: string[] = [];
    for (const term of item.contains) {
      const mapped = from === "content" ? patternToQuery(term) : queryToPattern(term);
      if (!mapped || mapped.length < 3) {
        warnings.push(`"${item.name}": pattern "${term}" is too short to translate — review it by hand.`);
        continue;
      }
      if (from === "content" && /\/.+\//.test(term)) {
        warnings.push(`"${item.name}": "${term}" looks like a deep URL path, not a phrase — check the derived topic makes sense.`);
      }
      if (brandTokens.has(mapped)) {
        warnings.push(`"${item.name}": "${mapped}" is (part of) the client's brand name — a brand topic cluster may not be what you want.`);
      }
      converted.push(mapped);
    }
    return {
      name: item.name,
      contains: converted,
      notContains: item.notContains.map((t) => (from === "content" ? patternToQuery(t) : queryToPattern(t))).filter(Boolean),
      description: `Derived 1:1 from the ${from === "content" ? "content group" : "topic cluster"} of the same name (SEO Gets import).`,
    };
  });
}

/**
 * Pull group definitions for one client from SEO Gets and map them onto the
 * app's content groups + topic clusters, deriving whichever side is missing.
 */
export async function pullSeoGetsGroups(clientKey: string): Promise<SeoGetsPullResult> {
  const warnings: string[] = [];
  const debug: SeoGetsPullResult["debug"] = { tools: [], calls: [] };

  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return { ok: false, message: "Unknown client.", warnings, debug };

  let mcp: McpClient;
  let tools: Awaited<ReturnType<McpClient["listTools"]>>;
  try {
    mcp = await seoGetsClient();
    tools = await mcp.listTools();
  } catch (err) {
    return { ok: false, message: (err as Error).message, warnings, debug };
  }
  debug.tools = tools.map((t) => t.name);
  const requiredKeys = (t: { inputSchema?: Record<string, unknown> }): string[] =>
    Array.isArray(t.inputSchema?.required) ? (t.inputSchema!.required as string[]) : [];

  // 1. Find the SEO Gets site/property matching this client's domain. Try
  // every listing-ish candidate, preferring tools that need no arguments —
  // a per-property tool (required property_id) can't list anything.
  const siteCandidates = tools
    .filter((t) => /site|propert|project|domain/i.test(t.name))
    .sort((a, b) => requiredKeys(a).length - requiredKeys(b).length || (/list|all/i.test(b.name) ? 1 : 0) - (/list|all/i.test(a.name) ? 1 : 0));
  let siteId: unknown = null;
  let siteLabel = "";
  for (const siteTool of siteCandidates) {
    if (requiredKeys(siteTool).length > 0) continue; // can't satisfy its arguments
    let sites: unknown;
    try {
      sites = await mcp.callTool(siteTool.name, {});
    } catch (err) {
      debug.calls.push({ tool: siteTool.name, args: {}, result: `ERROR: ${(err as Error).message}` });
      continue;
    }
    debug.calls.push({ tool: siteTool.name, args: {}, result: sites });
    const siteObjs = findGroupObjects(sites).length > 0 ? findGroupObjects(sites) : [];
    const wanted = norm(client.domain);
    const match = siteObjs.find((s) =>
      Object.values(s).some((v) => typeof v === "string" && (norm(v).includes(wanted) || wanted.includes(norm(v).replace(/^sc-domain:/, "")))),
    );
    if (match) {
      siteId = match.id ?? match.property_id ?? match.site_id ?? match.siteId ?? match.domain ?? match.url ?? match.property;
      siteLabel = groupName(match) || String(siteId);
      break;
    }
  }

  // 2. Call every group-ish tool, scoped to the site where the schema allows.
  const groupTools = tools.filter((t) => /group|cluster|topic|folder|segment/i.test(t.name));
  if (groupTools.length === 0) {
    return {
      ok: false,
      message: `Connected, but no group-related tools were found on the SEO Gets MCP. Tools available: ${debug.tools.join(", ") || "(none)"}.`,
      warnings,
      debug,
    };
  }

  const contentGroups: ImportGroupItem[] = [];
  const topicClusters: ImportGroupItem[] = [];

  for (const tool of groupTools) {
    const args: Record<string, unknown> = {};
    const props = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(props)) {
      if (/site|propert|project|domain|url/i.test(key)) {
        args[key] = /domain|url/i.test(key) ? client.domain : (siteId ?? client.domain);
      }
    }
    // Never call a tool whose required arguments we couldn't fill — a
    // guaranteed validation error tells us nothing and aborts nothing useful.
    const unfillable = requiredKeys(tool).filter((k) => !(k in args));
    if (unfillable.length > 0) {
      warnings.push(
        `Skipped tool "${tool.name}": couldn't supply required argument(s) ${unfillable.join(", ")}${siteId ? "" : " (no matching SEO Gets property was found for this client's domain)"}.`,
      );
      continue;
    }
    let result: unknown;
    try {
      result = await mcp.callTool(tool.name, args);
    } catch (err) {
      warnings.push(`Tool "${tool.name}" failed: ${(err as Error).message}`);
      debug.calls.push({ tool: tool.name, args, result: `ERROR: ${(err as Error).message}` });
      continue;
    }
    debug.calls.push({ tool: tool.name, args, result });

    const isContent = /content|page|url/i.test(tool.name);
    const target = isContent ? contentGroups : topicClusters;
    for (const obj of findGroupObjects(result)) {
      const name = groupName(obj);
      const arrays = stringArrays(obj);
      // Prefer explicitly named pattern fields; fall back to the first array.
      const patternKey =
        Object.keys(arrays).find((k) => /pattern|contain|include|match|term|keyword|quer|url|path/i.test(k)) ??
        Object.keys(arrays)[0];
      const excludeKey = Object.keys(arrays).find((k) => /exclude|not/i.test(k));
      if (!patternKey) {
        // Single-pattern groups sometimes carry a string field instead.
        const single = Object.entries(obj).find(
          ([k, v]) => typeof v === "string" && /pattern|contain|include|match|filter/i.test(k) && (v as string).trim(),
        );
        if (single) {
          target.push({ name, contains: [String(single[1]).trim()], notContains: [] });
        } else {
          warnings.push(`Group "${name}" from ${tool.name} had no recognisable pattern list — skipped (see debug).`);
        }
        continue;
      }
      target.push({
        name,
        contains: arrays[patternKey]!.map((s) => s.trim()).filter(Boolean),
        notContains: excludeKey ? arrays[excludeKey]!.map((s) => s.trim()).filter(Boolean) : [],
      });
    }
  }

  if (contentGroups.length === 0 && topicClusters.length === 0) {
    return {
      ok: false,
      message: `Connected${siteLabel ? ` (site: ${siteLabel})` : ""}, but no groups came back. Check the debug payload to see what the tools returned.`,
      warnings,
      debug,
    };
  }

  // 3. Derive whichever side SEO Gets didn't provide, 1:1 by name.
  if (contentGroups.length > 0 && topicClusters.length === 0) {
    topicClusters.push(...deriveCounterpart(contentGroups, "content", client.client_name, warnings));
  } else if (topicClusters.length > 0 && contentGroups.length === 0) {
    contentGroups.push(...deriveCounterpart(topicClusters, "topic", client.client_name, warnings));
  }

  return {
    ok: true,
    message: `Pulled ${contentGroups.length} content group(s) and ${topicClusters.length} topic cluster(s)${siteLabel ? ` for ${siteLabel}` : ""}. Review below, then import.`,
    proposal: { contentGroups, topicClusters },
    warnings,
    debug,
  };
}
