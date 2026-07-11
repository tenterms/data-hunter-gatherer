import "dotenv/config";
import { generateReport } from "../src/lib/reportGenerator";

/**
 * Generate one report snapshot.
 * Usage: npm run generate-report -- --client=CLIENT_KEY --period=PERIOD_KEY [--mock]
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
    console.error("Usage: npm run generate-report -- --client=CLIENT_KEY --period=PERIOD_KEY [--mock]");
    process.exit(1);
  }
  const { snapshot, snapshotPath } = await generateReport({ clientKey, periodKey, forceMock });
  console.log(
    `\nDone: ${snapshot.client.client_name} — ${snapshot.period.label} (${snapshot.dataSource} data)\n` +
      `View it at /reports/${clientKey}/${periodKey} once the dashboard is running (npm run dev).\n` +
      `Snapshot: ${snapshotPath}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
