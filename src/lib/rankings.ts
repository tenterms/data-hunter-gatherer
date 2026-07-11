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
 * SE Ranking adapter stub.
 *
 * The runtime app never depends on Claude-only tooling; this adapter is the
 * place to wire the SE Ranking REST API (https://seranking.com/api.html) once
 * an API key is available. Until implemented it returns null so the provider
 * chain falls through to CSV/sheet imports.
 */
export class SERankingProvider implements RankingProvider {
  readonly source = "se_ranking_api" as const;

  constructor(private apiKey: string) {}

  async getKeywordMovements(_client: ClientRow, _period: ReportPeriodRow): Promise<RankingMovement[] | null> {
    // TODO: implement against SE Ranking's /sites/{id}/positions endpoint.
    // Requires mapping client_key -> SE Ranking site id (add a column to the
    // Clients tab when this lands). Returning null keeps the fallback chain alive.
    return null;
  }
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
