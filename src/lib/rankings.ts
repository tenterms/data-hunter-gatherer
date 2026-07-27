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
 * Live SE Ranking adapter (Project Management API).
 *
 * Auth: `Authorization: Token <key>`. The client's SE Ranking project is
 * matched automatically by domain, keyword positions are pulled for the
 * report period, and start/end positions come from the first/last ranked
 * dates in the range. Any error returns null so the provider chain falls
 * through to CSV/sheet imports — a missing project or expired key can never
 * break report generation.
 */
const SERANKING_BASE = "https://api.seranking.com/v1/project-management";

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
  site_engine_id?: number;
  keywords?: SerKeyword[];
}

interface SerSearchEngine {
  site_engine_id?: number | string;
  id?: number | string;
  name?: string;
  title?: string;
  region_name?: string;
  region?: string;
  lang?: string;
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
    const res = await fetch(`${SERANKING_BASE}${path}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`SE Ranking API ${res.status} for ${path}`);
    }
    return (await res.json()) as T;
  }

  private async findSiteId(client: ClientRow): Promise<number | string | null> {
    const sites = await this.get<SerSite[]>("/sites");
    if (!Array.isArray(sites)) return null;
    const domain = client.domain.toLowerCase().replace(/^www\./, "");
    const match = sites.find((s) =>
      [s.name, s.title].some((v) => (v ?? "").toLowerCase().includes(domain)),
    );
    return match?.id ?? null;
  }

  private movementsFromBlock(
    block: SerEngineBlock,
    groupNameForKeyword: (kw: SerKeyword) => string | null,
  ): RankingMovement[] {
    const toPos = (value: number | string | null | undefined): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 && n <= 200 ? n : null;
    };
    const movements: RankingMovement[] = [];
    for (const kw of block.keywords ?? []) {
      const keyword = (kw.name ?? kw.keyword ?? String(kw.id ?? "")).trim();
      if (!keyword) continue;
      const entries = (kw.positions ?? [])
        .filter((p) => p.date)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (entries.length === 0) continue;
      const startPosition = toPos(entries[0].pos);
      const endPosition = toPos(entries[entries.length - 1].pos);
      const { change, direction } = classifyMovement(startPosition, endPosition);
      movements.push({
        keyword,
        startPosition,
        endPosition,
        change,
        direction,
        searchVolume: Number.isFinite(Number(kw.volume)) ? Number(kw.volume) : null,
        targetUrl: "",
        rankingUrl: kw.landing_pages?.[0]?.url ?? "",
        groupName: groupNameForKeyword(kw),
      });
    }
    return movements;
  }

  /**
   * Full per-search-engine pull: one positions call returns a block per
   * search engine configured in the SE Ranking project. Engine labels and
   * keyword group names are fetched best-effort — if those endpoints fail
   * the positions still come through with generic labels / no groups.
   */
  async getEngineData(client: ClientRow, period: ReportPeriodRow): Promise<EngineMovements[] | null> {
    try {
      const siteId = await this.findSiteId(client);
      if (siteId === null) {
        this.log(`SE Ranking: no project matching "${client.domain}" — falling back to imports.`);
        return null;
      }
      const blocks = await this.get<SerEngineBlock[]>(
        `/sites/positions?site_id=${siteId}&date_from=${period.start_date}&date_to=${period.end_date}`,
      );
      if (!Array.isArray(blocks) || blocks.length === 0) return null;

      const [engines, groups, keywordInfos] = await Promise.all([
        this.get<SerSearchEngine[]>(`/sites/${siteId}/search-engines`).catch(() => [] as SerSearchEngine[]),
        this.get<SerGroup[]>(`/sites/${siteId}/groups`).catch(() => [] as SerGroup[]),
        this.get<SerKeywordInfo[]>(`/sites/${siteId}/keywords`).catch(() => [] as SerKeywordInfo[]),
      ]);

      const engineLabels = new Map<string, string>();
      (Array.isArray(engines) ? engines : []).forEach((e, i) => {
        const id = String(e.site_engine_id ?? e.id ?? "");
        if (!id) return;
        const parts = [e.name ?? e.title ?? "", e.region_name ?? e.region ?? ""]
          .map((v) => String(v).trim())
          .filter(Boolean);
        engineLabels.set(id, parts.length > 0 ? parts.join(" — ") : `Search engine ${i + 1}`);
      });

      const groupNames = new Map<string, string>();
      (Array.isArray(groups) ? groups : []).forEach((g) => {
        const id = String(g.id ?? "");
        const name = String(g.name ?? g.title ?? "").trim();
        if (id && name) groupNames.set(id, name);
      });
      const keywordGroupIds = new Map<string, string>();
      (Array.isArray(keywordInfos) ? keywordInfos : []).forEach((k) => {
        const id = String(k.id ?? "");
        if (id && k.group_id !== null && k.group_id !== undefined) {
          keywordGroupIds.set(id, String(k.group_id));
        }
      });
      const groupNameForKeyword = (kw: SerKeyword): string | null => {
        const groupId =
          kw.group_id !== null && kw.group_id !== undefined
            ? String(kw.group_id)
            : keywordGroupIds.get(String(kw.id ?? ""));
        return groupId ? (groupNames.get(groupId) ?? null) : null;
      };

      const results: EngineMovements[] = [];
      blocks.forEach((block, i) => {
        const movements = this.movementsFromBlock(block, groupNameForKeyword);
        if (movements.length === 0) return;
        const id = String(block.site_engine_id ?? i);
        results.push({
          id,
          label: engineLabels.get(id) ?? `Search engine ${results.length + 1}`,
          movements,
        });
      });

      if (results.length === 0) {
        this.log("SE Ranking: project found but no keyword positions in the period.");
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
