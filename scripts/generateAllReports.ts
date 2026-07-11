import "dotenv/config";
import { generateReport, loadAdminConfig } from "../src/lib/reportGenerator";

/**
 * Generate snapshots for every active report period with status ready/pending.
 * Usage: npm run generate-all-reports [-- --mock]
 */
async function main() {
  const forceMock = process.argv.includes("--mock");
  const { config } = await loadAdminConfig();
  const activeClients = new Set(config.clients.filter((c) => c.active).map((c) => c.client_key));
  const periods = config.reportPeriods.filter(
    (p) => activeClients.has(p.client_key) && (p.status === "ready" || p.status === "pending"),
  );

  if (periods.length === 0) {
    console.log("No report periods with status ready/pending for active clients.");
    return;
  }

  let failures = 0;
  for (const period of periods) {
    console.log(`\n=== ${period.client_key} / ${period.period_key} (${period.label}) ===`);
    try {
      await generateReport({ clientKey: period.client_key, periodKey: period.period_key, forceMock });
    } catch (error) {
      failures += 1;
      console.error(`Failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\nGenerated ${periods.length - failures}/${periods.length} reports.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
