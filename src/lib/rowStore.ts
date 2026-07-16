import fs from "fs";
import path from "path";
import { DB_FILE, MOCK_DIR } from "./config";
import { appendRows, replaceTabRows, SHEET_SCHEMA } from "./sheets";

/**
 * Row storage for all in-app editors. Writes go to the app's built-in
 * database (data/db/config.json) by default, or to the Google Sheet when
 * CONFIG_BACKEND=sheets is set (the appendRows/replaceTabRows calls return
 * false unless the sheets backend is active).
 *
 * On the first local write, the database is seeded from the bundled demo
 * config so a fresh install isn't empty.
 */

function readLocal(): Record<string, Array<Record<string, unknown>>> {
  if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  const demo = path.join(MOCK_DIR, "sheet.json");
  if (fs.existsSync(demo)) return JSON.parse(fs.readFileSync(demo, "utf8"));
  return {};
}

function writeLocal(raw: Record<string, Array<Record<string, unknown>>>): void {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(raw, null, 2));
}

function stringifyRows(
  tab: keyof typeof SHEET_SCHEMA,
  rows: Array<Record<string, unknown>>,
): Array<Record<string, string>> {
  return rows.map((row) =>
    Object.fromEntries(
      SHEET_SCHEMA[tab].map((h) => [h, row[h] === null || row[h] === undefined ? "" : String(row[h])]),
    ),
  );
}

export async function appendRowsAnywhere(
  tab: keyof typeof SHEET_SCHEMA,
  rows: Array<Record<string, unknown>>,
): Promise<"sheet" | "local"> {
  if (await appendRows(tab, rows)) return "sheet";
  const raw = readLocal();
  raw[tab] = [...(Array.isArray(raw[tab]) ? raw[tab] : []), ...stringifyRows(tab, rows)];
  writeLocal(raw);
  return "local";
}

export async function replaceRowsAnywhere(
  tab: keyof typeof SHEET_SCHEMA,
  shouldRemove: (row: Record<string, unknown>) => boolean,
  newRows: Array<Record<string, unknown>>,
): Promise<"sheet" | "local"> {
  if (await replaceTabRows(tab, shouldRemove, newRows)) return "sheet";
  const raw = readLocal();
  const list = Array.isArray(raw[tab]) ? raw[tab] : [];
  raw[tab] = [...list.filter((r) => !shouldRemove(r)), ...stringifyRows(tab, newRows)];
  writeLocal(raw);
  return "local";
}

export const cell = (v: unknown) => String(v ?? "").trim();
