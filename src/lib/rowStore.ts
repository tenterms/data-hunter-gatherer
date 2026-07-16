import fs from "fs";
import path from "path";
import { MOCK_DIR } from "./config";
import { appendRows, replaceTabRows, SHEET_SCHEMA } from "./sheets";

/**
 * Row storage that works in both modes: writes go to the Google Sheet when
 * configured, otherwise to data/mock/sheet.json. All in-app editors write
 * through here so the sheet stays the single source of truth.
 */

function mockFile(): string {
  return path.join(MOCK_DIR, "sheet.json");
}

function readMock(): Record<string, Array<Record<string, unknown>>> {
  const file = mockFile();
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
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
): Promise<"sheet" | "mock"> {
  if (await appendRows(tab, rows)) return "sheet";
  const raw = readMock();
  raw[tab] = [...(Array.isArray(raw[tab]) ? raw[tab] : []), ...stringifyRows(tab, rows)];
  fs.writeFileSync(mockFile(), JSON.stringify(raw, null, 2));
  return "mock";
}

export async function replaceRowsAnywhere(
  tab: keyof typeof SHEET_SCHEMA,
  shouldRemove: (row: Record<string, unknown>) => boolean,
  newRows: Array<Record<string, unknown>>,
): Promise<"sheet" | "mock"> {
  if (await replaceTabRows(tab, shouldRemove, newRows)) return "sheet";
  const raw = readMock();
  const list = Array.isArray(raw[tab]) ? raw[tab] : [];
  raw[tab] = [...list.filter((r) => !shouldRemove(r)), ...stringifyRows(tab, newRows)];
  fs.writeFileSync(mockFile(), JSON.stringify(raw, null, 2));
  return "mock";
}

export const cell = (v: unknown) => String(v ?? "").trim();
