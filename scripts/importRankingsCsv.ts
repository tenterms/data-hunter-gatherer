import "dotenv/config";
import fs from "fs";
import path from "path";
import { RANKINGS_DIR } from "../src/lib/config";
import { appendRankingImports } from "../src/lib/sheets";
import type { RankingImportRow } from "../src/lib/types";

/**
 * Import a ranking CSV (e.g. an SE Ranking export) into the local format the
 * report generator reads, and append it to the RankingImports sheet tab when
 * Google Sheets is configured.
 *
 * Usage: npm run import-rankings-csv -- --file=PATH --client=CLIENT_KEY --period=PERIOD_KEY
 *
 * Expected columns (case-insensitive; common aliases accepted):
 *   keyword, start_position, end_position, search_engine, location, device,
 *   target_url, search_volume, ranking_url, visibility_score
 */

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

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

async function main() {
  const file = getArg("file");
  const clientKey = getArg("client");
  const periodKey = getArg("period");
  if (!file || !clientKey || !periodKey) {
    console.error(
      "Usage: npm run import-rankings-csv -- --file=PATH --client=CLIENT_KEY --period=PERIOD_KEY",
    );
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exit(1);
  }
  const headerMap = buildHeaderMap(rows[0]);
  if (headerMap.keyword === undefined || headerMap.end_position === undefined) {
    console.error(
      `Could not find required columns. Found headers: ${rows[0].join(", ")}\n` +
        `Need at least "keyword" and "end_position" (or "current position").`,
    );
    process.exit(1);
  }

  const imports: RankingImportRow[] = rows.slice(1).map((row) => ({
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
  })).filter((r) => r.keyword !== "");

  const dir = path.join(RANKINGS_DIR, clientKey);
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `${periodKey}.json`);
  fs.writeFileSync(outFile, JSON.stringify(imports, null, 2));
  console.log(`Imported ${imports.length} keywords to ${path.relative(process.cwd(), outFile)}`);

  try {
    const appended = await appendRankingImports(imports);
    if (appended) console.log("Also appended to the RankingImports sheet tab.");
    else console.log("Google Sheets not configured — local import only (that's fine; the report generator reads it).");
  } catch (error) {
    console.warn(`Could not append to sheet: ${error instanceof Error ? error.message : error}`);
  }
}

// Only run when executed directly (parseCsv is imported by tests).
if (process.argv[1] && process.argv[1].endsWith("importRankingsCsv.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
