import type { RankingImportRow } from "./types";

/**
 * CSV parsing for ranking imports (e.g. SE Ranking exports). Shared by the
 * CLI script and the admin UI upload.
 */

/** Minimal CSV parser with quoted-field support — avoids a dependency. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, string[]> = {
  keyword: ["keyword", "keywords", "query"],
  start_position: ["start_position", "start position", "position start", "previous position", "pos start"],
  end_position: ["end_position", "end position", "position end", "current position", "position", "pos end"],
  search_engine: ["search_engine", "search engine", "engine"],
  location: ["location", "region"],
  device: ["device"],
  target_url: ["target_url", "target url"],
  search_volume: ["search_volume", "search volume", "volume"],
  ranking_url: ["ranking_url", "ranking url", "url found", "found url", "url"],
  visibility_score: ["visibility_score", "visibility", "visibility score"],
};

function buildHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normalised = headers.map((h) => h.trim().toLowerCase());
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalised.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "" || value.trim() === "-") return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function mapCsvToImports(
  csvText: string,
  clientKey: string,
  periodKey: string,
): { rows: RankingImportRow[]; error: string | null } {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { rows: [], error: "The CSV has no data rows." };
  const headerMap = buildHeaderMap(rows[0]);
  if (headerMap.keyword === undefined || headerMap.end_position === undefined) {
    return {
      rows: [],
      error:
        `Could not find the required columns. Found: ${rows[0].join(", ")}. ` +
        `The file needs at least a "keyword" column and an "end position" (or "current position") column.`,
    };
  }
  const imports = rows
    .slice(1)
    .map((row) => ({
      client_key: clientKey,
      period_key: periodKey,
      keyword: (row[headerMap.keyword] ?? "").trim(),
      start_position: num(row[headerMap.start_position]),
      end_position: num(row[headerMap.end_position]),
      search_engine: (row[headerMap.search_engine] ?? "").trim(),
      location: (row[headerMap.location] ?? "").trim(),
      device: (row[headerMap.device] ?? "").trim(),
      target_url: (row[headerMap.target_url] ?? "").trim(),
      search_volume: num(row[headerMap.search_volume]),
      ranking_url: (row[headerMap.ranking_url] ?? "").trim(),
      visibility_score: num(row[headerMap.visibility_score]),
    }))
    .filter((r) => r.keyword !== "");
  return { rows: imports, error: null };
}
