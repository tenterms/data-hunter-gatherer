import fs from "fs";
import path from "path";
import { REPORTS_DIR } from "./config";
import { readSnapshot } from "./snapshots";
import { replaceRowsAnywhere, cell } from "./rowStore";
import type { ActionResult } from "./adminActions";
import type { DrawCategory, DrawTaskRow, DrawTiming, ReportSnapshot } from "./types";

/**
 * In-report DRAW editing: the work grid is a 2×4 matrix (Priority Tasks This
 * Month / What We Did Last Month × the four DRAW columns) and each cell is a
 * free-text box. One line of text = one task. Saving a cell:
 *  1. replaces that cell's DrawTasks rows (survives regeneration)
 *  2. patches the draft snapshot in place (visible instantly)
 */

const TIMINGS: DrawTiming[] = ["completed_this_month", "planned_next_month"];
const CATEGORIES: DrawCategory[] = ["design_dev", "reactive_seo", "anything_else", "writing"];

/** One task per non-empty line; leading list markers are stripped. */
export function linesToTasks(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
    .filter((line) => line !== "");
}

export async function saveDrawCell(input: {
  clientKey: string;
  periodKey: string;
  timing: string;
  category: string;
  text: string;
}): Promise<ActionResult> {
  const timing = TIMINGS.find((t) => t === input.timing);
  const category = CATEGORIES.find((c) => c === input.category);
  if (!timing || !category) return { ok: false, message: "Unknown work grid cell." };

  const snapshot = readSnapshot(input.clientKey, input.periodKey);
  if (!snapshot) return { ok: false, message: "Report not found — generate it first." };

  const rows: DrawTaskRow[] = linesToTasks(input.text).map((line) => ({
    client_key: input.clientKey,
    period_key: input.periodKey,
    timing,
    category,
    title: line,
    description: "",
    status: "",
  }));

  await replaceRowsAnywhere(
    "DrawTasks",
    (r) =>
      cell(r.client_key) === input.clientKey &&
      cell(r.period_key) === input.periodKey &&
      cell(r.timing) === timing &&
      cell(r.category) === category,
    rows as unknown as Array<Record<string, unknown>>,
  );

  const updated: ReportSnapshot = {
    ...snapshot,
    drawTasks: [
      ...snapshot.drawTasks.filter((t) => !(t.timing === timing && t.category === category)),
      ...rows,
    ],
  };
  fs.writeFileSync(
    path.join(REPORTS_DIR, input.clientKey, `${input.periodKey}.json`),
    JSON.stringify(updated, null, 2),
  );

  return {
    ok: true,
    message: "Saved. The published version updates when you next click Publish.",
  };
}
