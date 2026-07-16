import fs from "fs";
import path from "path";
import { REPORTS_DIR } from "./config";
import { readSnapshot } from "./snapshots";
import { replaceRowsAnywhere, cell } from "./rowStore";
import type { ActionResult } from "./adminActions";
import type { CommentarySection, ReportSnapshot } from "./types";

/**
 * In-app commentary editing. Saving an override:
 *  1. upserts a NarrativeOverrides row (so the wording survives regeneration)
 *  2. updates the draft snapshot in place (so the change is visible instantly,
 *     without a full re-fetch of GSC data)
 * An empty override reverts the section to the suggested text.
 */

const SECTIONS: CommentarySection[] = [
  "executive_summary",
  "traffic",
  "content_groups",
  "topic_clusters",
  "cannibalisation",
  "rankings",
  "strategic_priorities",
];

export async function saveCommentaryOverride(input: {
  clientKey: string;
  periodKey: string;
  section: string;
  overrideText: string;
}): Promise<ActionResult> {
  const section = SECTIONS.find((s) => s === input.section);
  if (!section) return { ok: false, message: `Unknown section "${input.section}".` };

  const snapshot = readSnapshot(input.clientKey, input.periodKey);
  if (!snapshot) return { ok: false, message: "Report not found — generate it first." };

  const entry = snapshot.commentary.find((c) => c.section === section);
  if (!entry) return { ok: false, message: "That section has no commentary in this report." };

  const overrideText = input.overrideText.trim();
  const clearing = overrideText === "";

  // 1. Sheet (or mock) — one row per client/period/section.
  await replaceRowsAnywhere(
    "NarrativeOverrides",
    (r) =>
      cell(r.client_key) === input.clientKey &&
      cell(r.period_key) === input.periodKey &&
      cell(r.section) === section,
    clearing
      ? []
      : [
          {
            client_key: input.clientKey,
            period_key: input.periodKey,
            section,
            suggested_text: entry.suggestedText,
            override_text: overrideText,
            final_text: overrideText,
            approved_by: "dashboard",
            approved_at: new Date().toISOString().slice(0, 10),
          },
        ],
  );

  // 2. Draft snapshot, updated in place.
  const updated: ReportSnapshot = {
    ...snapshot,
    commentary: snapshot.commentary.map((c) =>
      c.section === section
        ? {
            ...c,
            overrideText: clearing ? null : overrideText,
            finalText: clearing ? c.suggestedText : overrideText,
            mode: clearing ? c.suggestedSource : "human_override",
          }
        : c,
    ),
  };
  fs.writeFileSync(
    path.join(REPORTS_DIR, input.clientKey, `${input.periodKey}.json`),
    JSON.stringify(updated, null, 2),
  );

  return {
    ok: true,
    message: clearing
      ? "Reverted to the suggested text."
      : "Saved. The published version updates when you next click Publish.",
  };
}
