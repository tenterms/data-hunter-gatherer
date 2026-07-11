import "dotenv/config";
import fs from "fs";
import path from "path";
import { getAppConfig, DATA_DIR } from "../src/lib/config";
import { loadAdminConfig } from "../src/lib/sheets";
import { LiveGscAdapter, MockGscAdapter } from "../src/lib/gsc";

/**
 * Debug/inspection utility: fetch (or mock) GSC data for a client/period and
 * write it to data/cache so you can eyeball what the report generator will see.
 * Usage: npm run fetch-gsc -- --client=CLIENT_KEY --period=PERIOD_KEY [--mock]
 */
function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function main() {
  const clientKey = getArg("client");
  const periodKey = getArg("period");
  const forceMock = process.argv.includes("--mock");
  if (!clientKey || !periodKey) {
    console.error("Usage: npm run fetch-gsc -- --client=CLIENT_KEY --period=PERIOD_KEY [--mock]");
    process.exit(1);
  }

  const app = getAppConfig();
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  const period = config.reportPeriods.find((p) => p.client_key === clientKey && p.period_key === periodKey);
  if (!client || !period) {
    console.error("Unknown client or period. Check the Clients / ReportPeriods tabs.");
    process.exit(1);
  }

  const adapter = app.hasGoogleCredentials && !forceMock ? new LiveGscAdapter() : new MockGscAdapter(config);
  console.log(`Fetching via ${adapter.source} adapter…`);
  const [current, comparison] = await Promise.all([
    adapter.fetchDataset(client, { startDate: period.start_date, endDate: period.end_date }),
    adapter.fetchDataset(client, {
      startDate: period.comparison_start_date,
      endDate: period.comparison_end_date,
    }),
  ]);

  const dir = path.join(DATA_DIR, "cache");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `gsc-${clientKey}-${periodKey}.json`);
  fs.writeFileSync(file, JSON.stringify({ current, comparison }, null, 2));
  console.log(
    `Current: ${current.pages.length} pages / ${current.queries.length} queries / ${current.queryPages.length} query+page rows.`,
  );
  console.log(`Written to ${path.relative(process.cwd(), file)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
