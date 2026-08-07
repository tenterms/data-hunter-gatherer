import fs from "fs";
import path from "path";
import { REPORTS_DIR } from "./config";
import { readSnapshot } from "./snapshots";
import { replaceRowsAnywhere, cell } from "./rowStore";
import type { ActionResult } from "./adminActions";
import type { ReportSnapshot } from "./types";

/**
 * Account Manager Assistant notes: one free-text blob per client/month with
 * the priorities, client concerns and in-flight work. Saved notes steer the
 * auto-written commentary the next time the report is generated, and are
 * stored on the snapshot so the team view shows what the commentary was
 * briefed with.
 */

export async function saveFocusNotes(input: {
  clientKey: string;
  periodKey: string;
  notes: string;
}): Promise<ActionResult> {
  const notes = input.notes.trim();

  await replaceRowsAnywhere(
    "FocusNotes",
    (r) => cell(r.client_key) === input.clientKey && cell(r.period_key) === input.periodKey,
    notes === "" ? [] : [{ client_key: input.clientKey, period_key: input.periodKey, notes }],
  );

  // Show the saved notes on the draft snapshot straight away (commentary
  // itself refreshes on the next Generate).
  const snapshot = readSnapshot(input.clientKey, input.periodKey);
  if (snapshot) {
    const updated: ReportSnapshot = { ...snapshot, focusNotes: notes === "" ? null : notes };
    fs.writeFileSync(
      path.join(REPORTS_DIR, input.clientKey, `${input.periodKey}.json`),
      JSON.stringify(updated, null, 2),
    );
  }

  return {
    ok: true,
    message:
      notes === ""
        ? "Notes cleared."
        : "Notes saved. Hit Regenerate and the commentary will be written around them.",
  };
}
