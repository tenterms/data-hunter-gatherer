import fs from "fs";
import path from "path";
import type {
  ClientRow,
  RankingImportRow,
  RankingMovement,
  RankingSummary,
  ReportPeriodRow,
} from "./types";
import { RANKINGS_DIR } from "./config";

/**
 * Rankings integration.
 *
 * Providers implement getKeywordMovements(); the report generator asks each in
 * order (SE Ranking API -> local CSV import -> Sheet RankingImports rows) and
 * uses the first that has data. All movement/summary maths lives here and is
 * unit-tested, independent of where the positions came from.
 */

export interface RankingProvider {
  readonly source: RankingSummary["source"];
  getKeywordMovements(client: ClientRow, period: ReportPeriodRow): Promise<RankingMovement[] | null>;
  /** account-level visibility score if the provider can supply one */
  getVisibilityScore?(client: ClientRow, period: ReportPeriodRow): Promise<number | null>;
}

export function classifyMovement(
  startPosition: number | null,
  endPosition: number | null,
): Pick<RankingMovement, "change" | "direction"> {
  const hasStart = startPosition !== null && startPosition > 0;
  const hasEnd = endPosition !== null && endPosition > 0;
  if (!hasStart && !hasEnd) return { change: null, direction: "flat" };
  if (!hasStart && hasEnd) return { change: null, direction: "entered" };
  if (hasStart && !hasEnd) return { change: null, direction: "dropped" };
  const change = (startPosition as number) - (endPosition as number); // positive = improved
  if (change > 0) return { change, direction: "up" };
  if (change < 0) return { change, direction: "down" };
  return { change: 0, direction: "flat" };
}

export function movementFromImportRow(row: RankingImportRow): RankingMovement {
  const { change, direction } = classifyMovement(row.start_position, row.end_position);
  return {
    keyword: row.keyword,
    startPosition: row.start_position,
    endPosition: row.end_position,
    change,
    direction,
    searchVolume: row.search_volume,
    targetUrl: row.target_url,
    rankingUrl: row.ranking_url,
  };
}

function countAtOrBetter(positions: Array<number | null>, threshold: number): number {
  return positions.filter((p) => p !== null && p > 0 && p <= threshold).length;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function summariseRankings(
  movements: RankingMovement[],
  source: RankingSummary["source"],
  visibilityScore: number | null = null,
  notableLimit = 8,
): RankingSummary {
  const positionsUp = movements.filter((m) => m.direction === "up").length;
  const positionsDown = movements.filter((m) => m.direction === "down").length;
  const entered = movements.filter((m) => m.direction === "entered").length;
  const dropped = movements.filter((m) => m.direction === "dropped").length;

  const startPositions = movements.map((m) => m.startPosition);
  const endPositions = movements.map((m) => m.endPosition);

  const gains = movements
    .filter((m) => m.direction === "up" || m.direction === "entered")
    .sort((a, b) => {
      // Entrances at strong positions first, then biggest place gains.
      if (a.direction === "entered" && b.direction === "entered")
        return (a.endPosition ?? 999) - (b.endPosition ?? 999);
      if (a.direction === "entered") return (a.endPosition ?? 999) <= 10 ? -1 : 1;
      if (b.direction === "entered") return (b.endPosition ?? 999) <= 10 ? 1 : -1;
      return (b.change ?? 0) - (a.change ?? 0);
    });

  const declines = movements
    .filter((m) => m.direction === "down" || m.direction === "dropped")
    .sort((a, b) => {
      if (a.direction === "dropped" && b.direction !== "dropped") return -1;
      if (b.direction === "dropped" && a.direction !== "dropped") return 1;
      return (a.change ?? 0) - (b.change ?? 0);
    });

  return {
    keywordsTracked: movements.length,
    positionsUp,
    positionsDown,
    entered,
    dropped,
    top3: {
      current: countAtOrBetter(endPositions, 3),
      previous: countAtOrBetter(startPositions, 3),
    },
    top10: {
      current: countAtOrBetter(endPositions, 10),
      previous: countAtOrBetter(startPositions, 10),
    },
    top30: {
      current: countAtOrBetter(endPositions, 30),
      previous: countAtOrBetter(startPositions, 30),
    },
    averagePosition: {
      current: average(endPositions.filter((p): p is number => p !== null && p > 0)),
      previous: average(startPositions.filter((p): p is number => p !== null && p > 0)),
    },
    visibilityScore,
    notableGains: gains.slice(0, notableLimit),
    notableDeclines: declines.slice(0, notableLimit),
    movements,
    source,
  };
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Reads rows from the RankingImports sheet tab (already loaded into AdminConfig). */
export class SheetImportRankingProvider implements RankingProvider {
  readonly source = "sheet_import" as const;

  constructor(private imports: RankingImportRow[]) {}

  async getKeywordMovements(client: ClientRow, period: ReportPeriodRow): Promise<RankingMovement[] | null> {
    const rows = this.imports.filter(
      (r) => r.client_key === client.client_key && r.period_key === period.period_key,
    );
    if (rows.length === 0) return null;
    return rows.map(movementFromImportRow);
  }

  async getVisibilityScore(client: ClientRow, period: ReportPeriodRow): Promise<number | null> {
    // Convention: put the account-level visibility score (e.g. 6 for 6%) in the
    // visibility_score column of any RankingImports row; the first non-empty
    // value for the client/period wins.
    const row = this.imports.find(
      (r) =>
        r.client_key === client.client_key &&
        r.period_key === period.period_key &&
        r.visibility_score !== null,
    );
    return row?.visibility_score ?? null;
  }
}

/** Reads a locally imported CSV (written by `npm run import-rankings-csv`). */
export class LocalCsvRankingProvider implements RankingProvider {
  readonly source = "csv_import" as const;

  private loadRows(client: ClientRow, period: ReportPeriodRow): RankingImportRow[] | null {
    const file = path.join(RANKINGS_DIR, client.client_key, `${period.period_key}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as RankingImportRow[];
    } catch {
      return null;
    }
  }

  async getKeywordMovements(client: ClientRow, period: ReportPeriodRow): Promise<RankingMovement[] | null> {
    const rows = this.loadRows(client, period);
    if (!rows || rows.length === 0) return null;
    return rows.map(movementFromImportRow);
  }

  async getVisibilityScore(client: ClientRow, period: ReportPeriodRow): Promise<number | null> {
    const rows = this.loadRows(client, period);
    return rows?.find((r) => r.visibility_score !== null)?.visibility_score ?? null;
  }
}

/**
 * Live SE Ranking adapter (Project Management API,
 * https://seranking.com/api/project/project-management/).
 *
 * Auth: `Authorization: Token <key>`. The client's SE Ranking project is
 * matched automatically by domain, keyword positions are pulled for the
 * report period, and start/end positions come from the first/last ranked
 * dates in the range. Any error returns null so the provider chain falls
 * through to CSV/sheet imports — a missing project or expired key can never
 * break report generation.
 *
 * Endpoint notes (these tripped us up once already):
 *  - GET /sites/positions returns one block per search engine, but its
 *    keyword objects carry only the keyword ID — names and group
 *    assignments come from GET /keywords?site_id=…
 *  - search engines are GET /sites/search-engines?site_id=… (query param,
 *    not a path segment) and keyword groups are GET /keywords/groups?site_id=…
 *  - engine display names live in a separate dictionary endpoint
 *    (/v1/system/search-engines), fetched best-effort.
 */
const SERANKING_BASE =
  process.env.SERANKING_API_BASE || "https://api.seranking.com/v1/project-management";
const SERANKING_SYSTEM_ENGINES =
  process.env.SERANKING_SYSTEM_ENGINES_URL || "https://api.seranking.com/v1/system/search-engines";

interface SerSite {
  id: number | string;
  title?: string;
  name?: string;
}

interface SerPositionEntry {
  date?: string;
  pos?: number | string | null;
}

interface SerKeyword {
  id?: number | string;
  name?: string;
  keyword?: string;
  volume?: number | string | null;
  group_id?: number | string | null;
  positions?: SerPositionEntry[];
  landing_pages?: Array<{ url?: string }>;
}

interface SerEngineBlock {
  site_engine_id?: number | string;
  keywords?: SerKeyword[];
}

interface SerSiteEngine {
  site_engine_id?: number | string;
  search_engine_id?: number | string;
  region_name?: string | null;
  lang_code?: string | null;
  keyword_count?: number;
}

interface SerSystemEngine {
  id?: number | string;
  name?: string;
  title?: string;
}

interface SerGroup {
  id?: number | string;
  name?: string;
  title?: string;
}

interface SerKeywordInfo {
  id?: number | string;
  name?: string;
  keyword?: string;
  group_id?: number | string | null;
}

/** One SE Ranking search engine's tracked keywords, before summarising. */
export interface EngineMovements {
  id: string;
  label: string;
  movements: RankingMovement[];
}

export class SERankingProvider implements RankingProvider {
  readonly source = "se_ranking_api" as const;

  constructor(
    private apiKey: string,
    private log: (message: string) => void = () => {},
  ) {}

  private async get<T>(path: string): Promise<T> {
    const url = path.startsWith("http") ? path : `${SERANKING_BASE}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Token ${this.apiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`SE Ranking API ${res.status} for ${path}`);
    }
    return (await res.json()) as T;
  }

  private async findSiteId(client: ClientRow): Promise<number | string | null> {
    const sites = await this.get<SerSite[]>("/sites");
    if (!Array.isArray(sites)) return null;
    const domain = client.domain.toLowerCase().replace(/^www\./, "");
    // Match on the project URL first (name is the site URL in /sites), then title.
    const match = sites.find((s) =>
      [s.name, s.title].some((v) => (v ?? "").toLowerCase().includes(domain)),
    );
    return match?.id ?? null;
  }

  private movementsFromBlock(
    block: SerEngineBlock,
    keywordInfoById: Map<string, { name: string; groupId: string | null }>,
    groupNames: Map<string, string>,
  ): RankingMovement[] {
    const toPos = (value: number | string | null | undefined): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 && n <= 200 ? n : null;
    };
    const movements: RankingMovement[] = [];
    const seen = new Set<string>();
    for (const kw of block.keywords ?? []) {
      // The positions endpoint only carries keyword IDs; names come from /keywords.
      const info = keywordInfoById.get(String(kw.id ?? ""));
      const keyword = (kw.name ?? kw.keyword ?? info?.name ?? "").trim();
      if (!keyword || seen.has(keyword)) continue;
      seen.add(keyword);
      const entries = (kw.positions ?? [])
        .filter((p) => p.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (entries.length === 0) continue;
      const startPosition = toPos(entries[0].pos);
      const endPosition = toPos(entries[entries.length - 1].pos);
      const { change, direction } = classifyMovement(startPosition, endPosition);
      const groupId =
        kw.group_id !== null && kw.group_id !== undefined ? String(kw.group_id) : (info?.groupId ?? null);
      movements.push({
        keyword,
        startPosition,
        endPosition,
        change,
        direction,
        searchVolume: Number.isFinite(Number(kw.volume)) ? Number(kw.volume) : null,
        targetUrl: "",
        rankingUrl: kw.landing_pages?.[0]?.url ?? "",
        groupName: groupId ? (groupNames.get(groupId) ?? null) : null,
      });
    }
    return movements;
  }

  private async fetchLookups(siteId: number | string): Promise<{
    engines: SerSiteEngine[];
    keywordInfoById: Map<string, { name: string; groupId: string | null }>;
    groupNames: Map<string, string>;
    systemEngineNames: Map<string, string>;
  }> {
    const [engines, groups, keywordInfos, systemEngines] = await Promise.all([
      this.get<SerSiteEngine[]>(`/sites/search-engines?site_id=${siteId}`).catch(() => [] as SerSiteEngine[]),
      this.get<SerGroup[]>(`/keywords/groups?site_id=${siteId}`).catch(() => [] as SerGroup[]),
      this.get<SerKeywordInfo[]>(`/keywords?site_id=${siteId}`).catch(() => [] as SerKeywordInfo[]),
      this.get<SerSystemEngine[]>(SERANKING_SYSTEM_ENGINES).catch(() => [] as SerSystemEngine[]),
    ]);

    const groupNames = new Map<string, string>();
    (Array.isArray(groups) ? groups : []).forEach((g) => {
      const id = String(g.id ?? "");
      const name = String(g.name ?? g.title ?? "").trim();
      if (id && name) groupNames.set(id, name);
    });

    const keywordInfoById = new Map<string, { name: string; groupId: string | null }>();
    (Array.isArray(keywordInfos) ? keywordInfos : []).forEach((k) => {
      const id = String(k.id ?? "");
      const name = String(k.name ?? k.keyword ?? "").trim();
      if (!id || !name) return;
      keywordInfoById.set(id, {
        name,
        groupId: k.group_id !== null && k.group_id !== undefined ? String(k.group_id) : null,
      });
    });

    const systemEngineNames = new Map<string, string>();
    (Array.isArray(systemEngines) ? systemEngines : []).forEach((e) => {
      const id = String(e.id ?? "");
      const name = String(e.name ?? e.title ?? "").trim();
      if (id && name) systemEngineNames.set(id, name);
    });

    return {
      engines: Array.isArray(engines) ? engines : [],
      keywordInfoById,
      groupNames,
      systemEngineNames,
    };
  }

  private engineLabels(
    engines: SerSiteEngine[],
    systemEngineNames: Map<string, string>,
  ): Map<string, string> {
    const labels = new Map<string, string>();
    engines.forEach((e, i) => {
      const id = String(e.site_engine_id ?? "");
      if (!id) return;
      const engineName = systemEngineNames.get(String(e.search_engine_id ?? "")) ?? "";
      const region = String(e.region_name ?? "").trim();
      const parts = [engineName, region].filter(Boolean);
      labels.set(
        id,
        parts.length > 0 ? parts.join(" — ") : String(e.lang_code ?? "").trim() || `Search engine ${i + 1}`,
      );
    });
    return labels;
  }

  /**
   * Positions, one call per configured search engine. A single combined call
   * can come back with only the project's default engine, so when the engine
   * list is known each engine is queried explicitly with site_engine_id and
   * the blocks are merged (falling back to one combined call otherwise).
   */
  private async fetchEngineBlocks(
    siteId: number | string,
    period: ReportPeriodRow,
    engines: SerSiteEngine[],
  ): Promise<SerEngineBlock[]> {
    const posPath = (extra: string) =>
      `/sites/positions?site_id=${siteId}&date_from=${period.start_date}&date_to=${period.end_date}${extra}`;

    const merged = new Map<string, SerEngineBlock>();
    const addBlocks = (list: SerEngineBlock[], fallbackEngineId?: number | string) => {
      for (const block of Array.isArray(list) ? list : []) {
        const id = String(block.site_engine_id ?? fallbackEngineId ?? merged.size);
        const existing = merged.get(id);
        if (existing) {
          existing.keywords = [...(existing.keywords ?? []), ...(block.keywords ?? [])];
        } else {
          merged.set(id, { site_engine_id: id, keywords: [...(block.keywords ?? [])] });
        }
      }
    };

    if (engines.length > 0) {
      const perEngine = await Promise.all(
        engines.map((e) =>
          this.get<SerEngineBlock[]>(posPath(`&site_engine_id=${e.site_engine_id}`)).catch(
            () => [] as SerEngineBlock[],
          ),
        ),
      );
      engines.forEach((e, i) => addBlocks(perEngine[i], e.site_engine_id));
    }
    if (merged.size === 0) {
      const combined = await this.get<SerEngineBlock[]>(posPath("")).catch(() => [] as SerEngineBlock[]);
      addBlocks(combined);
    }
    return [...merged.values()];
  }

  /**
   * Full per-search-engine pull. Keyword names, group names and engine
   * labels are joined in from the lookup endpoints (best-effort — missing
   * lookups degrade to generic labels, never to a failed pull).
   */
  async getEngineData(client: ClientRow, period: ReportPeriodRow): Promise<EngineMovements[] | null> {
    try {
      const siteId = await this.findSiteId(client);
      if (siteId === null) {
        this.log(`SE Ranking: no project matching "${client.domain}" — falling back to imports.`);
        return null;
      }
      const lookups = await this.fetchLookups(siteId);
      const blocks = await this.fetchEngineBlocks(siteId, period, lookups.engines);
      if (blocks.length === 0) {
        this.log("SE Ranking: positions response was empty — falling back to imports.");
        return null;
      }

      const labels = this.engineLabels(lookups.engines, lookups.systemEngineNames);
      const results: EngineMovements[] = [];
      blocks.forEach((block, i) => {
        const movements = this.movementsFromBlock(block, lookups.keywordInfoById, lookups.groupNames);
        if (movements.length === 0) return;
        const id = String(block.site_engine_id ?? i);
        results.push({
          id,
          label: labels.get(id) ?? `Search engine ${results.length + 1}`,
          movements,
        });
      });

      if (results.length === 0) {
        this.log(
          "SE Ranking: project found but no usable keyword positions in the period (keyword names missing or no ranked dates).",
        );
        return null;
      }
      const total = results.reduce((sum, e) => sum + e.movements.length, 0);
      this.log(
        `SE Ranking: pulled ${total} keyword positions across ${results.length} search engine${results.length === 1 ? "" : "s"} for ${client.domain}.`,
      );
      return results;
    } catch (error) {
      this.log(
        `SE Ranking API failed (${error instanceof Error ? error.message : error}) — falling back to imports.`,
      );
      return null;
    }
  }

  /**
   * Connection test for the admin panel: walks the same calls as a real pull
   * and reports what each one returned, so a misconfigured key/project can
   * be diagnosed without reading server logs.
   */
  async probe(client: ClientRow, period: ReportPeriodRow): Promise<string[]> {
    const lines: string[] = [];
    try {
      const sites = await this.get<SerSite[]>("/sites");
      if (!Array.isArray(sites)) {
        lines.push("✗ /sites did not return a list — unexpected API response.");
        return lines;
      }
      lines.push(`✓ API key works — ${sites.length} project${sites.length === 1 ? "" : "s"} in the account.`);
      const domain = client.domain.toLowerCase().replace(/^www\./, "");
      const match = sites.find((s) => [s.name, s.title].some((v) => (v ?? "").toLowerCase().includes(domain)));
      if (!match) {
        lines.push(`✗ No project matches "${domain}".`);
        lines.push(
          `  Projects seen: ${sites
            .slice(0, 15)
            .map((s) => s.title || s.name || s.id)
            .join(", ")}${sites.length > 15 ? ", …" : ""}`,
        );
        lines.push("  Fix: make the client's Website field match the project URL/title in SE Ranking.");
        return lines;
      }
      lines.push(`✓ Matched project: ${match.title || match.name} (id ${match.id}).`);

      const lookups = await this.fetchLookups(match.id);
      const labels = this.engineLabels(lookups.engines, lookups.systemEngineNames);
      if (lookups.engines.length === 0) {
        lines.push("✗ No search engines returned for the project.");
      } else {
        lines.push(
          `✓ ${lookups.engines.length} search engine${lookups.engines.length === 1 ? "" : "s"}: ${lookups.engines
            .map((e) => labels.get(String(e.site_engine_id ?? "")) ?? String(e.site_engine_id))
            .join(" · ")}`,
        );
      }
      lines.push(
        `${lookups.keywordInfoById.size > 0 ? "✓" : "✗"} ${lookups.keywordInfoById.size} keywords, ${lookups.groupNames.size} keyword group${lookups.groupNames.size === 1 ? "" : "s"}${lookups.groupNames.size > 0 ? ` (${[...lookups.groupNames.values()].slice(0, 8).join(", ")})` : ""}.`,
      );

      const blocks = await this.fetchEngineBlocks(match.id, period, lookups.engines);
      if (blocks.length === 0) {
        lines.push(`✗ No position data between ${period.start_date} and ${period.end_date}.`);
        return lines;
      }
      for (const block of blocks) {
        const id = String(block.site_engine_id ?? "?");
        const withDates = (block.keywords ?? []).filter((k) => (k.positions ?? []).some((p) => p.date)).length;
        lines.push(
          `✓ ${labels.get(id) ?? `engine ${id}`}: ${block.keywords?.length ?? 0} keywords, ${withDates} with ranked dates in the period.`,
        );
      }
      lines.push("Looks healthy — regenerate the report to pull this data in.");
    } catch (error) {
      lines.push(`✗ SE Ranking API error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return lines;
  }

  async getKeywordMovements(client: ClientRow, period: ReportPeriodRow): Promise<RankingMovement[] | null> {
    const engines = await this.getEngineData(client, period);
    if (!engines) return null;
    return dedupeMovements(engines);
  }
}

/** Combined view across engines: first engine's entry wins for a repeated keyword. */
export function dedupeMovements(engines: EngineMovements[]): RankingMovement[] {
  const seen = new Map<string, RankingMovement>();
  for (const engine of engines) {
    for (const m of engine.movements) {
      if (!seen.has(m.keyword)) seen.set(m.keyword, m);
    }
  }
  return [...seen.values()];
}

export async function resolveRankings(
  providers: RankingProvider[],
  client: ClientRow,
  period: ReportPeriodRow,
): Promise<RankingSummary> {
  for (const provider of providers) {
    const movements = await provider.getKeywordMovements(client, period);
    if (movements && movements.length > 0) {
      const visibility = provider.getVisibilityScore
        ? await provider.getVisibilityScore(client, period)
        : null;
      return summariseRankings(movements, provider.source, visibility);
    }
  }
  return summariseRankings([], "unavailable");
}
