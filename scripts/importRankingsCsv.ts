import "dotenv/config";
import fs from "fs";
import path from "path";
import { RANKINGS_DIR } from "../src/lib/config";
import { appendRankingImports } from "../src/lib/sheets";
import { mapCsvToImports } from "../src/lib/rankingsCsv";

/**
 * Import a ranking CSV (e.g. an SE Ranking export) into the local format the
 * report generator reads, and append it to the RankingImports sheet tab when
 * Google Sheets is configured. The same import is available in the Admin page
 * of the dashboard — this script exists for automation.
 *
 * Usage: npm run import-rankings-csv -- --file=PATH --client=CLIENT_KEY --period=PERIOD_KEY
 */

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
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

  const { rows: imports, error } = mapCsvToImports(fs.readFileSync(file, "utf8"), clientKey, periodKey);
  if (error) {
    console.error(error);
    process.exit(1);
  }

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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
