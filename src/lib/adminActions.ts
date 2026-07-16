import fs from "fs";
import path from "path";
import { getAppConfig, RANKINGS_DIR } from "./config";
import { appendRows, loadAdminConfig, setupSheet } from "./sheets";
import { appendRowsAnywhere } from "./rowStore";
import { mapCsvToImports } from "./rankingsCsv";
import { listSnapshots } from "./snapshots";
import type { AdminConfig, ClientRow, ReportPeriodRow } from "./types";

/**
 * Actions behind the Admin page. Day-to-day use of the tool is entirely
 * button-driven from the dashboard; these functions do the work.
 *
 * Storage: the app's built-in database by default (data/db/config.json), or
 * Google Sheets when CONFIG_BACKEND=sheets is set — see rowStore.ts.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

// Row writing (sheet or mock file) lives in rowStore.ts and is shared with
// the in-app editors.
const writeRows = appendRowsAnywhere;

// ---------------------------------------------------------------------------
// Overview data for the Admin page
// ---------------------------------------------------------------------------

export interface ClientOverview {
  client: ClientRow;
  periods: Array<ReportPeriodRow & { hasSnapshot: boolean }>;
  counts: { pages: number; contentGroups: number; topicClusters: number; drawTasks: number; rankingImports: number };
}

export interface AdminOverview {
  configSource: "sheets" | "local";
  sheetUrl: string | null;
  hasGoogleCredentials: boolean;
  llmEnabled: boolean;
  clients: ClientOverview[];
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const app = getAppConfig();
  const { config, source } = await loadAdminConfig();
  const snapshots = listSnapshots();
  const hasSnapshot = new Set(snapshots.map((s) => `${s.clientKey}:${s.periodKey}`));

  const clients = config.clients.map((client) => ({
    client,
    periods: config.reportPeriods
      .filter((p) => p.client_key === client.client_key)
      .sort((a, b) => b.period_key.localeCompare(a.period_key))
      .map((p) => ({ ...p, hasSnapshot: hasSnapshot.has(`${client.client_key}:${p.period_key}`) })),
    counts: {
      pages: config.clientPages.filter((r) => r.client_key === client.client_key && r.active).length,
      contentGroups: config.contentGroups.filter((r) => r.client_key === client.client_key && r.active).length,
      topicClusters: config.topicClusters.filter((r) => r.client_key === client.client_key && r.active).length,
      drawTasks: config.drawTasks.filter((r) => r.client_key === client.client_key).length,
      rankingImports: config.rankingImports.filter((r) => r.client_key === client.client_key).length,
    },
  }));

  return {
    configSource: source,
    sheetUrl:
      source === "sheets" && app.googleSheetId
        ? `https://docs.google.com/spreadsheets/d/${app.googleSheetId}`
        : null,
    hasGoogleCredentials: app.hasGoogleCredentials,
    llmEnabled: app.enableLlmCommentary && Boolean(app.anthropicApiKey),
    clients,
  };
}

// ---------------------------------------------------------------------------
// Create client
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function lastFullMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthDates(monthKey: string): {
  label: string;
  start: string;
  end: string;
  compStart: string;
  compEnd: string;
} | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const compStart = new Date(Date.UTC(year, month - 2, 1));
  const compEnd = new Date(Date.UTC(year, month - 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    label: start.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
    start: iso(start),
    end: iso(end),
    compStart: iso(compStart),
    compEnd: iso(compEnd),
  };
}

export async function createClient(input: {
  clientName: string;
  domain: string;
  gscPropertyUrl?: string;
  firstMonth?: string; // YYYY-MM; defaults to the last full month
}): Promise<ActionResult & { clientKey?: string }> {
  const clientName = input.clientName.trim();
  const domain = input.domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!clientName || !domain) return { ok: false, message: "Client name and domain are both required." };

  const clientKey = slugify(clientName);
  if (!clientKey) return { ok: false, message: "Could not derive a key from that client name." };

  const { config } = await loadAdminConfig();
  if (config.clients.some((c) => c.client_key === clientKey)) {
    return { ok: false, message: `A client with the key "${clientKey}" already exists.` };
  }

  const gscPropertyUrl = input.gscPropertyUrl?.trim() || `sc-domain:${domain}`;

  const where = await writeRows("Clients", [
    {
      client_key: clientKey,
      client_name: clientName,
      domain,
      gsc_property_url: gscPropertyUrl,
      timezone: "Europe/London",
      active: "true",
      notes: "",
    },
  ]);

  // Seed the homepage so the pages table isn't empty on the first report.
  await writeRows("ClientPages", [
    {
      client_key: clientKey,
      url: `https://${domain}/`,
      label: "Homepage",
      page_role: "primary",
      content_type: "commercial",
      commercial_priority: "high",
      active: "true",
      notes: "Added automatically when the client was created.",
    },
  ]);

  // First reporting month.
  const month = monthDates(input.firstMonth?.trim() || lastFullMonth());
  if (month) {
    await writeRows("ReportPeriods", [
      {
        period_key: input.firstMonth?.trim() || lastFullMonth(),
        client_key: clientKey,
        label: month.label,
        start_date: month.start,
        end_date: month.end,
        comparison_start_date: month.compStart,
        comparison_end_date: month.compEnd,
        status: "ready",
      },
    ]);
  }

  return {
    ok: true,
    clientKey,
    message:
      `Created "${clientName}" (key: ${clientKey}) with a homepage entry and its first reporting month` +
      (where === "sheet" ? " (synced to the Google Sheet)." : "."),
  };
}

// ---------------------------------------------------------------------------
// Add a reporting month
// ---------------------------------------------------------------------------

export async function addPeriod(input: { clientKey: string; month: string }): Promise<ActionResult> {
  const month = monthDates(input.month);
  if (!month) return { ok: false, message: `"${input.month}" is not a valid month — use the YYYY-MM format, e.g. 2026-07.` };

  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === input.clientKey);
  if (!client) return { ok: false, message: `Unknown client "${input.clientKey}".` };
  if (config.reportPeriods.some((p) => p.client_key === input.clientKey && p.period_key === input.month.trim())) {
    return { ok: false, message: `${month.label} already exists for ${client.client_name}.` };
  }

  const where = await writeRows("ReportPeriods", [
    {
      period_key: input.month.trim(),
      client_key: input.clientKey,
      label: month.label,
      start_date: month.start,
      end_date: month.end,
      comparison_start_date: month.compStart,
      comparison_end_date: month.compEnd,
      status: "ready",
    },
  ]);
  return {
    ok: true,
    message: `Added ${month.label} for ${client.client_name} (compared against the previous month)${where === "sheet" ? " (synced to the Google Sheet)" : ""}.`,
  };
}

// ---------------------------------------------------------------------------
// Rankings CSV upload
// ---------------------------------------------------------------------------

export async function importRankingsCsvText(input: {
  clientKey: string;
  periodKey: string;
  csvText: string;
}): Promise<ActionResult> {
  const { rows, error } = mapCsvToImports(input.csvText, input.clientKey, input.periodKey);
  if (error) return { ok: false, message: error };
  if (rows.length === 0) return { ok: false, message: "No keywords found in that file." };

  // Always write the local file (the report generator reads it in every mode)…
  const dir = path.join(RANKINGS_DIR, input.clientKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${input.periodKey}.json`), JSON.stringify(rows, null, 2));

  // …and mirror into the sheet when configured so the team can see/edit it there.
  let sheetNote = "";
  try {
    const appended = await appendRows("RankingImports", rows as unknown as Array<Record<string, unknown>>);
    sheetNote = appended ? " and added to the RankingImports sheet tab" : "";
  } catch (e) {
    sheetNote = ` (couldn't write to the sheet: ${e instanceof Error ? e.message : e})`;
  }

  return { ok: true, message: `Imported ${rows.length} keywords${sheetNote}. Regenerate the report to include them.` };
}

// ---------------------------------------------------------------------------
// Sheet setup from the UI
// ---------------------------------------------------------------------------

export async function runSetupSheet(): Promise<ActionResult> {
  const app = getAppConfig();
  if (!app.googleSheetId || !app.hasGoogleCredentials) {
    return {
      ok: false,
      message:
        "Google Sheets isn't connected yet. Add GOOGLE_SHEET_ID and the service-account credentials to the .env file (one-time setup), then restart the app.",
    };
  }
  const result = await setupSheet();
  const parts: string[] = [];
  if (result.created.length) parts.push(`created tabs: ${result.created.join(", ")}`);
  if (result.headersWritten.length) parts.push(`wrote headers for: ${result.headersWritten.join(", ")}`);
  if (result.ok.length) parts.push(`${result.ok.length} tabs already valid`);
  if (result.problems.length) parts.push(`PROBLEMS: ${result.problems.join(" | ")}`);
  return {
    ok: result.problems.length === 0,
    message: parts.join("; ") || "Sheet checked — nothing to do.",
  };
}

export type { AdminConfig };
