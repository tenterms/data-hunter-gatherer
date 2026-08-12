import { getAppConfig } from "./config";
import { loadAdminConfig } from "./sheets";
import type { ActionResult } from "./adminActions";
import type { ClientRow } from "./types";

/**
 * SE Ranking project setup from inside the tool: add search engines
 * (engine + location), create keyword groups, and add keywords into groups —
 * pushed straight to SE Ranking via the same API the report generator reads
 * from, so anything created here appears in reports on the next generation.
 *
 * Endpoints (verified against seranking.com/api project-management docs):
 *  - POST {base}/sites/search-engines?site_id=…  {search_engine_id, region_name?, …} -> {site_engine_id}
 *  - POST {base}/keywords/groups                 {site_id, name}                     -> {group_id}
 *  - POST {base}/keywords?site_id=…              [{keyword, group_id?, target_url?}] -> {added, ids}
 */

const BASE = process.env.SERANKING_API_BASE || "https://api.seranking.com/v1/project-management";
const SYSTEM_ENGINES =
  process.env.SERANKING_SYSTEM_ENGINES_URL || "https://api.seranking.com/v1/system/search-engines";

function apiKeyOrThrow(): string {
  const key = getAppConfig().seRankingApiKey;
  if (!key) throw new Error("SERANKING_API_KEY is not configured.");
  return key;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Token ${apiKeyOrThrow()}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SE Ranking API ${res.status} for ${method} ${path}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

async function findClientSite(clientKey: string): Promise<{ client: ClientRow; siteId: number | string }> {
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) throw new Error("Unknown client.");
  const sites = await request<Array<{ id: number | string; title?: string; name?: string }>>("GET", "/sites");
  const domain = client.domain.toLowerCase().replace(/^www\./, "");
  const match = (Array.isArray(sites) ? sites : []).find((s) =>
    [s.name, s.title].some((v) => (v ?? "").toLowerCase().includes(domain)),
  );
  if (!match) throw new Error(`No SE Ranking project matches ${client.domain} — create the project in SE Ranking first.`);
  return { client, siteId: match.id };
}

// ---------------------------------------------------------------------------
// Status (current setup + the pickable engine dictionary)
// ---------------------------------------------------------------------------

export interface SeRankingSetupStatus {
  ok: boolean;
  message: string;
  siteLabel?: string;
  engines?: Array<{ siteEngineId: string; label: string; keywordCount?: number }>;
  groups?: Array<{ id: string; name: string }>;
  keywordCount?: number;
  /** system dictionary for the "add engine" picker */
  systemEngines?: Array<{ id: string; name: string }>;
}

export async function seRankingSetupStatus(clientKey: string): Promise<SeRankingSetupStatus> {
  try {
    const { client, siteId } = await findClientSite(clientKey);

    const [engines, groups, keywords, system] = await Promise.all([
      request<Array<{ site_engine_id?: number | string; search_engine_id?: number | string; region_name?: string | null }>>(
        "GET",
        `/sites/search-engines?site_id=${siteId}`,
      ).catch(() => []),
      request<Array<{ id?: number | string; name?: string; title?: string }>>(
        "GET",
        `/keywords/groups?site_id=${siteId}`,
      ).catch(() => []),
      request<Array<{ id?: number | string }>>("GET", `/keywords?site_id=${siteId}`).catch(() => []),
      request<Array<{ id?: number | string; name?: string; title?: string }>>("GET", SYSTEM_ENGINES).catch(() => []),
    ]);

    const systemNames = new Map(
      (Array.isArray(system) ? system : []).map((e) => [String(e.id), e.name ?? e.title ?? `Engine ${e.id}`]),
    );

    return {
      ok: true,
      message: "",
      siteLabel: `${client.client_name} (site ${siteId})`,
      engines: (Array.isArray(engines) ? engines : []).map((e) => ({
        siteEngineId: String(e.site_engine_id ?? ""),
        label: [systemNames.get(String(e.search_engine_id)) ?? `Engine ${e.search_engine_id}`, e.region_name]
          .filter(Boolean)
          .join(" — "),
      })),
      groups: (Array.isArray(groups) ? groups : []).map((g) => ({
        id: String(g.id ?? ""),
        name: g.name ?? g.title ?? `Group ${g.id}`,
      })),
      keywordCount: Array.isArray(keywords) ? keywords.length : 0,
      systemEngines: [...systemNames.entries()].map(([id, name]) => ({ id, name })),
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function addSearchEngine(input: {
  clientKey: string;
  searchEngineId: string;
  regionName?: string;
}): Promise<ActionResult> {
  try {
    const { siteId } = await findClientSite(input.clientKey);
    const body: Record<string, unknown> = { search_engine_id: Number(input.searchEngineId) };
    if (input.regionName?.trim()) body.region_name = input.regionName.trim();
    const result = await request<{ site_engine_id?: number | string }>(
      "POST",
      `/sites/search-engines?site_id=${siteId}`,
      body,
    );
    return {
      ok: true,
      message: `Search engine added (id ${result?.site_engine_id ?? "?"}). It will appear in reports once it has ranking data.`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function addKeywordGroup(input: { clientKey: string; name: string }): Promise<ActionResult> {
  try {
    const name = input.name.trim();
    if (!name) return { ok: false, message: "Give the group a name." };
    const { siteId } = await findClientSite(input.clientKey);
    const result = await request<{ group_id?: number | string }>("POST", "/keywords/groups", {
      site_id: siteId,
      name,
    });
    return { ok: true, message: `Group "${name}" created (id ${result?.group_id ?? "?"}).` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function addKeywords(input: {
  clientKey: string;
  keywords: string[];
  groupId?: string;
  targetUrl?: string;
}): Promise<ActionResult> {
  try {
    const keywords = input.keywords.map((k) => k.trim()).filter(Boolean);
    if (keywords.length === 0) return { ok: false, message: "Add at least one keyword." };
    const { siteId } = await findClientSite(input.clientKey);
    const rows = keywords.map((keyword) => {
      const row: Record<string, unknown> = { keyword };
      if (input.groupId) row.group_id = Number(input.groupId);
      if (input.targetUrl?.trim()) row.target_url = input.targetUrl.trim();
      return row;
    });
    const result = await request<{ added?: number; ids?: unknown[] }>("POST", `/keywords?site_id=${siteId}`, rows);
    const added = result?.added ?? result?.ids?.length ?? keywords.length;
    return { ok: true, message: `${added} keyword(s) added. They start collecting positions on SE Ranking's next check.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
