import fs from "fs";
import path from "path";
import { google, type sheets_v4 } from "googleapis";
import { getAppConfig, MOCK_DIR } from "./config";
import type {
  AdminConfig,
  AiSearchPromptRow,
  ClientPageRow,
  ClientRow,
  ContentGroupRow,
  ContentGroupUrlRow,
  DrawTaskRow,
  GeneratedReportRow,
  NarrativeOverrideRow,
  RankingImportRow,
  RankingKeywordRow,
  ReportPeriodRow,
  StrategicNoteRow,
  TopicClusterRow,
  TopicClusterRuleRow,
} from "./types";

/**
 * Google Sheets is the internal admin backend. This module owns:
 *  - the canonical tab/column schema (used by `npm run setup-sheet`)
 *  - reading tabs into typed rows
 *  - a mock fallback (data/mock/sheet.json) so everything works with no creds
 */

export const SHEET_SCHEMA: Record<string, string[]> = {
  Clients: ["client_key", "client_name", "domain", "gsc_property_url", "timezone", "active", "notes"],
  ReportPeriods: [
    "period_key",
    "client_key",
    "label",
    "start_date",
    "end_date",
    "comparison_start_date",
    "comparison_end_date",
    "status",
  ],
  ClientPages: [
    "client_key",
    "url",
    "label",
    "page_role",
    "content_type",
    "commercial_priority",
    "active",
    "notes",
  ],
  ContentGroups: ["client_key", "group_key", "group_name", "description", "active"],
  ContentGroupUrls: ["client_key", "group_key", "url", "match_type", "active"],
  TopicClusters: ["client_key", "topic_key", "topic_name", "description", "active"],
  TopicClusterRules: ["client_key", "topic_key", "match_type", "query_text", "case_sensitive", "active"],
  DrawTasks: ["client_key", "period_key", "timing", "category", "title", "description", "status"],
  RankingKeywords: [
    "client_key",
    "keyword",
    "market",
    "location",
    "device",
    "target_url",
    "priority",
    "active",
  ],
  RankingImports: [
    "client_key",
    "period_key",
    "keyword",
    "start_position",
    "end_position",
    "search_engine",
    "location",
    "device",
    "target_url",
    "search_volume",
    "ranking_url",
    "visibility_score",
  ],
  AiSearchPrompts: [
    "client_key",
    "prompt_key",
    "prompt",
    "engine",
    "market",
    "expected_brand",
    "expected_url",
    "priority",
    "active",
  ],
  NarrativeOverrides: [
    "client_key",
    "period_key",
    "section",
    "suggested_text",
    "override_text",
    "final_text",
    "approved_by",
    "approved_at",
  ],
  StrategicNotes: ["client_key", "period_key", "note_type", "title", "body", "priority", "active"],
  GeneratedReports: ["client_key", "period_key", "generated_at", "snapshot_path", "dashboard_url", "status"],
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export function getGoogleAuth() {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inlineJson && inlineJson.trim() !== "") {
    const credentials = JSON.parse(inlineJson);
    return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  }
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsPath && fs.existsSync(credsPath)) {
    return new google.auth.GoogleAuth({ keyFile: credsPath, scopes: SCOPES });
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }
  throw new Error(
    "No Google credentials configured. Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or the GOOGLE_OAUTH_* variables.",
  );
}

export function getSheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: getGoogleAuth() as never });
}

// ---------------------------------------------------------------------------
// Row parsing helpers
// ---------------------------------------------------------------------------

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y";
}

function parseNum(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string {
  return String(value ?? "").trim();
}

type RawRow = Record<string, unknown>;

function rowsToObjects(values: unknown[][]): RawRow[] {
  if (!values || values.length < 2) return [];
  const headers = values[0].map((h) => String(h ?? "").trim());
  return values.slice(1).map((row) => {
    const obj: RawRow = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

// Per-tab parsers keep sheet quirks (string booleans, blank numbers) out of the app.
const parsers = {
  Clients: (r: RawRow): ClientRow => ({
    client_key: str(r.client_key),
    client_name: str(r.client_name),
    domain: str(r.domain),
    gsc_property_url: str(r.gsc_property_url),
    timezone: str(r.timezone) || "Europe/London",
    active: parseBool(r.active),
    notes: str(r.notes),
  }),
  ReportPeriods: (r: RawRow): ReportPeriodRow => ({
    period_key: str(r.period_key),
    client_key: str(r.client_key),
    label: str(r.label),
    start_date: str(r.start_date),
    end_date: str(r.end_date),
    comparison_start_date: str(r.comparison_start_date),
    comparison_end_date: str(r.comparison_end_date),
    status: (str(r.status) || "pending") as ReportPeriodRow["status"],
  }),
  ClientPages: (r: RawRow): ClientPageRow => ({
    client_key: str(r.client_key),
    url: str(r.url),
    label: str(r.label),
    page_role: (str(r.page_role) || "rest_of_site") as ClientPageRow["page_role"],
    content_type: (str(r.content_type) || "other") as ClientPageRow["content_type"],
    commercial_priority: (str(r.commercial_priority) || "low") as ClientPageRow["commercial_priority"],
    active: parseBool(r.active),
    notes: str(r.notes),
  }),
  ContentGroups: (r: RawRow): ContentGroupRow => ({
    client_key: str(r.client_key),
    group_key: str(r.group_key),
    group_name: str(r.group_name),
    description: str(r.description),
    active: parseBool(r.active),
  }),
  ContentGroupUrls: (r: RawRow): ContentGroupUrlRow => ({
    client_key: str(r.client_key),
    group_key: str(r.group_key),
    url: str(r.url),
    match_type: (str(r.match_type) || "contains") as ContentGroupUrlRow["match_type"],
    active: parseBool(r.active),
  }),
  TopicClusters: (r: RawRow): TopicClusterRow => ({
    client_key: str(r.client_key),
    topic_key: str(r.topic_key),
    topic_name: str(r.topic_name),
    description: str(r.description),
    active: parseBool(r.active),
  }),
  TopicClusterRules: (r: RawRow): TopicClusterRuleRow => ({
    client_key: str(r.client_key),
    topic_key: str(r.topic_key),
    match_type: (str(r.match_type) || "contains") as TopicClusterRuleRow["match_type"],
    query_text: str(r.query_text),
    case_sensitive: parseBool(r.case_sensitive),
    active: parseBool(r.active),
  }),
  DrawTasks: (r: RawRow): DrawTaskRow => ({
    client_key: str(r.client_key),
    period_key: str(r.period_key),
    timing: (str(r.timing) || "completed_this_month") as DrawTaskRow["timing"],
    category: (str(r.category) || "anything_else") as DrawTaskRow["category"],
    title: str(r.title),
    description: str(r.description),
    status: str(r.status),
  }),
  RankingKeywords: (r: RawRow): RankingKeywordRow => ({
    client_key: str(r.client_key),
    keyword: str(r.keyword),
    market: str(r.market),
    location: str(r.location),
    device: str(r.device) || "desktop",
    target_url: str(r.target_url),
    priority: str(r.priority),
    active: parseBool(r.active),
  }),
  RankingImports: (r: RawRow): RankingImportRow => ({
    client_key: str(r.client_key),
    period_key: str(r.period_key),
    keyword: str(r.keyword),
    start_position: parseNum(r.start_position),
    end_position: parseNum(r.end_position),
    search_engine: str(r.search_engine),
    location: str(r.location),
    device: str(r.device),
    target_url: str(r.target_url),
    search_volume: parseNum(r.search_volume),
    ranking_url: str(r.ranking_url),
    visibility_score: parseNum(r.visibility_score),
  }),
  AiSearchPrompts: (r: RawRow): AiSearchPromptRow => ({
    client_key: str(r.client_key),
    prompt_key: str(r.prompt_key),
    prompt: str(r.prompt),
    engine: str(r.engine),
    market: str(r.market),
    expected_brand: str(r.expected_brand),
    expected_url: str(r.expected_url),
    priority: str(r.priority),
    active: parseBool(r.active),
  }),
  NarrativeOverrides: (r: RawRow): NarrativeOverrideRow => ({
    client_key: str(r.client_key),
    period_key: str(r.period_key),
    section: str(r.section),
    suggested_text: str(r.suggested_text),
    override_text: str(r.override_text),
    final_text: str(r.final_text),
    approved_by: str(r.approved_by),
    approved_at: str(r.approved_at),
  }),
  StrategicNotes: (r: RawRow): StrategicNoteRow => ({
    client_key: str(r.client_key),
    period_key: str(r.period_key),
    note_type: str(r.note_type),
    title: str(r.title),
    body: str(r.body),
    priority: str(r.priority),
    active: parseBool(r.active),
  }),
};

// ---------------------------------------------------------------------------
// AdminConfig loading (live Sheets or mock)
// ---------------------------------------------------------------------------

async function readTab(sheets: sheets_v4.Sheets, spreadsheetId: string, tab: string): Promise<RawRow[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:Z10000`,
  });
  return rowsToObjects((res.data.values ?? []) as unknown[][]);
}

export async function loadAdminConfigFromSheets(): Promise<AdminConfig> {
  const { googleSheetId } = getAppConfig();
  if (!googleSheetId) throw new Error("GOOGLE_SHEET_ID is not set");
  const sheets = getSheetsClient();

  const [
    clients,
    reportPeriods,
    clientPages,
    contentGroups,
    contentGroupUrls,
    topicClusters,
    topicClusterRules,
    drawTasks,
    rankingKeywords,
    rankingImports,
    aiSearchPrompts,
    narrativeOverrides,
    strategicNotes,
  ] = await Promise.all([
    readTab(sheets, googleSheetId, "Clients"),
    readTab(sheets, googleSheetId, "ReportPeriods"),
    readTab(sheets, googleSheetId, "ClientPages"),
    readTab(sheets, googleSheetId, "ContentGroups"),
    readTab(sheets, googleSheetId, "ContentGroupUrls"),
    readTab(sheets, googleSheetId, "TopicClusters"),
    readTab(sheets, googleSheetId, "TopicClusterRules"),
    readTab(sheets, googleSheetId, "DrawTasks"),
    readTab(sheets, googleSheetId, "RankingKeywords"),
    readTab(sheets, googleSheetId, "RankingImports"),
    readTab(sheets, googleSheetId, "AiSearchPrompts"),
    readTab(sheets, googleSheetId, "NarrativeOverrides"),
    readTab(sheets, googleSheetId, "StrategicNotes"),
  ]);

  return {
    clients: clients.map(parsers.Clients),
    reportPeriods: reportPeriods.map(parsers.ReportPeriods),
    clientPages: clientPages.map(parsers.ClientPages),
    contentGroups: contentGroups.map(parsers.ContentGroups),
    contentGroupUrls: contentGroupUrls.map(parsers.ContentGroupUrls),
    topicClusters: topicClusters.map(parsers.TopicClusters),
    topicClusterRules: topicClusterRules.map(parsers.TopicClusterRules),
    drawTasks: drawTasks.map(parsers.DrawTasks),
    rankingKeywords: rankingKeywords.map(parsers.RankingKeywords),
    rankingImports: rankingImports.map(parsers.RankingImports),
    aiSearchPrompts: aiSearchPrompts.map(parsers.AiSearchPrompts),
    narrativeOverrides: narrativeOverrides.map(parsers.NarrativeOverrides),
    strategicNotes: strategicNotes.map(parsers.StrategicNotes),
  };
}

export function loadAdminConfigFromMock(): AdminConfig {
  const file = path.join(MOCK_DIR, "sheet.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, RawRow[]>;
  return {
    clients: (raw.Clients ?? []).map(parsers.Clients),
    reportPeriods: (raw.ReportPeriods ?? []).map(parsers.ReportPeriods),
    clientPages: (raw.ClientPages ?? []).map(parsers.ClientPages),
    contentGroups: (raw.ContentGroups ?? []).map(parsers.ContentGroups),
    contentGroupUrls: (raw.ContentGroupUrls ?? []).map(parsers.ContentGroupUrls),
    topicClusters: (raw.TopicClusters ?? []).map(parsers.TopicClusters),
    topicClusterRules: (raw.TopicClusterRules ?? []).map(parsers.TopicClusterRules),
    drawTasks: (raw.DrawTasks ?? []).map(parsers.DrawTasks),
    rankingKeywords: (raw.RankingKeywords ?? []).map(parsers.RankingKeywords),
    rankingImports: (raw.RankingImports ?? []).map(parsers.RankingImports),
    aiSearchPrompts: (raw.AiSearchPrompts ?? []).map(parsers.AiSearchPrompts),
    narrativeOverrides: (raw.NarrativeOverrides ?? []).map(parsers.NarrativeOverrides),
    strategicNotes: (raw.StrategicNotes ?? []).map(parsers.StrategicNotes),
  };
}

/** Load admin config from Sheets when configured, otherwise from mock data. */
export async function loadAdminConfig(): Promise<{ config: AdminConfig; source: "sheets" | "mock" }> {
  const app = getAppConfig();
  if (app.hasSheets) {
    return { config: await loadAdminConfigFromSheets(), source: "sheets" };
  }
  return { config: loadAdminConfigFromMock(), source: "mock" };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Upsert a row in GeneratedReports keyed on client_key+period_key. */
export async function recordGeneratedReport(row: GeneratedReportRow): Promise<boolean> {
  const app = getAppConfig();
  if (!app.hasSheets || !app.googleSheetId) return false;
  const sheets = getSheetsClient();
  const existing = await readTab(sheets, app.googleSheetId, "GeneratedReports");
  const headers = SHEET_SCHEMA.GeneratedReports;
  const values = headers.map((h) => String(row[h as keyof GeneratedReportRow] ?? ""));

  const matchIndex = existing.findIndex(
    (r) => str(r.client_key) === row.client_key && str(r.period_key) === row.period_key,
  );
  if (matchIndex >= 0) {
    // +2: one for the header row, one because sheet rows are 1-indexed.
    const rowNumber = matchIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: app.googleSheetId,
      range: `GeneratedReports!A${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [values] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: app.googleSheetId,
      range: "GeneratedReports!A1",
      valueInputOption: "RAW",
      requestBody: { values: [values] },
    });
  }
  return true;
}

/**
 * Append rows to any schema tab (column order taken from SHEET_SCHEMA).
 * Returns false when Sheets isn't configured so callers can fall back to mock.
 */
export async function appendRows(tab: keyof typeof SHEET_SCHEMA, rows: Array<Record<string, unknown>>): Promise<boolean> {
  const app = getAppConfig();
  if (!app.hasSheets || !app.googleSheetId || rows.length === 0) return false;
  const sheets = getSheetsClient();
  const headers = SHEET_SCHEMA[tab];
  const values = rows.map((row) =>
    headers.map((h) => {
      const v = row[h];
      return v === null || v === undefined ? "" : String(v);
    }),
  );
  await sheets.spreadsheets.values.append({
    spreadsheetId: app.googleSheetId,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  return true;
}

/**
 * Replace rows in a schema tab: removes rows matching `shouldRemove` and
 * appends `newRows`, preserving all other rows. Used by the in-app editors.
 * Returns false when Sheets isn't configured so callers can fall back to mock.
 */
export async function replaceTabRows(
  tab: keyof typeof SHEET_SCHEMA,
  shouldRemove: (row: Record<string, unknown>) => boolean,
  newRows: Array<Record<string, unknown>>,
): Promise<boolean> {
  const app = getAppConfig();
  if (!app.hasSheets || !app.googleSheetId) return false;
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: app.googleSheetId,
    range: `${tab}!A1:Z10000`,
  });
  const values = (res.data.values ?? []) as unknown[][];
  const headers = values.length > 0 ? values[0].map((h) => String(h ?? "").trim()) : SHEET_SCHEMA[tab];

  const keptRows = values.slice(1).filter((rowArr) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => (obj[h] = rowArr[i]));
    return !shouldRemove(obj);
  });

  const appendedRows = newRows.map((row) =>
    headers.map((h) => {
      const v = row[h];
      return v === null || v === undefined ? "" : String(v);
    }),
  );

  await sheets.spreadsheets.values.clear({
    spreadsheetId: app.googleSheetId,
    range: `${tab}!A2:Z10000`,
  });
  const all = [...keptRows, ...appendedRows];
  if (all.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: app.googleSheetId,
      range: `${tab}!A2`,
      valueInputOption: "RAW",
      requestBody: { values: all as string[][] },
    });
  }
  return true;
}

/** Append RankingImports rows (used by the CSV importer when Sheets is configured). */
export async function appendRankingImports(rows: RankingImportRow[]): Promise<boolean> {
  return appendRows("RankingImports", rows as unknown as Array<Record<string, unknown>>);
}

// ---------------------------------------------------------------------------
// Setup / validation (npm run setup-sheet)
// ---------------------------------------------------------------------------

export interface SetupResult {
  created: string[];
  headersWritten: string[];
  ok: string[];
  problems: string[];
}

export async function setupSheet(): Promise<SetupResult> {
  const app = getAppConfig();
  if (!app.googleSheetId) throw new Error("GOOGLE_SHEET_ID is not set");
  const sheets = getSheetsClient();
  const result: SetupResult = { created: [], headersWritten: [], ok: [], problems: [] };

  const meta = await sheets.spreadsheets.get({ spreadsheetId: app.googleSheetId });
  const existingTabs = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean),
  );

  const toCreate = Object.keys(SHEET_SCHEMA).filter((tab) => !existingTabs.has(tab));
  if (toCreate.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: app.googleSheetId,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
    result.created.push(...toCreate);
  }

  for (const [tab, headers] of Object.entries(SHEET_SCHEMA)) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: app.googleSheetId,
      range: `${tab}!1:1`,
    });
    const currentHeaders = (res.data.values?.[0] ?? []).map((h) => String(h).trim());
    if (currentHeaders.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: app.googleSheetId,
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
      result.headersWritten.push(tab);
    } else {
      const missing = headers.filter((h) => !currentHeaders.includes(h));
      if (missing.length > 0) {
        result.problems.push(`${tab}: missing columns ${missing.join(", ")} — add them manually (existing data is never overwritten).`);
      } else {
        result.ok.push(tab);
      }
    }
  }
  return result;
}
