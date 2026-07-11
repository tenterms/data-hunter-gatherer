import "dotenv/config";
import { getAppConfig } from "../src/lib/config";
import { setupSheet, SHEET_SCHEMA } from "../src/lib/sheets";

/**
 * Creates or validates the Google Sheet tabs and headers.
 * Usage: npm run setup-sheet
 */
async function main() {
  const app = getAppConfig();
  if (!app.googleSheetId || !app.hasGoogleCredentials) {
    console.log("Google Sheets is not configured (GOOGLE_SHEET_ID and credentials required).");
    console.log("\nThe sheet structure the app expects:");
    for (const [tab, headers] of Object.entries(SHEET_SCHEMA)) {
      console.log(`\n  ${tab}`);
      console.log(`    ${headers.join(" | ")}`);
    }
    console.log("\nIn the meantime the app runs from data/mock/sheet.json (mock mode).");
    process.exitCode = app.googleSheetId ? 1 : 0;
    return;
  }

  console.log(`Validating sheet ${app.googleSheetId}…`);
  const result = await setupSheet();
  if (result.created.length) console.log(`Created tabs: ${result.created.join(", ")}`);
  if (result.headersWritten.length) console.log(`Wrote headers for: ${result.headersWritten.join(", ")}`);
  if (result.ok.length) console.log(`Already valid: ${result.ok.join(", ")}`);
  for (const problem of result.problems) console.warn(`⚠ ${problem}`);
  console.log(result.problems.length === 0 ? "\nSheet structure is valid." : "\nSheet has problems — see warnings above.");
  process.exitCode = result.problems.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
