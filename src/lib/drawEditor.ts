import { loadAdminConfig } from "./sheets";
import { replaceRowsAnywhere, cell } from "./rowStore";
import type { ActionResult } from "./adminActions";
import type { ClientRow, DrawCategory, DrawTaskRow, DrawTiming, ReportPeriodRow } from "./types";

/** In-app editor for the monthly DRAW work grid. */

export interface DrawEditorData {
  client: ClientRow;
  period: ReportPeriodRow;
  tasks: DrawTaskRow[];
}

export async function getDrawEditorData(clientKey: string, periodKey: string): Promise<DrawEditorData | null> {
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  const period = config.reportPeriods.find((p) => p.client_key === clientKey && p.period_key === periodKey);
  if (!client || !period) return null;
  return {
    client,
    period,
    tasks: config.drawTasks.filter((t) => t.client_key === clientKey && t.period_key === periodKey),
  };
}

export interface EditableTask {
  timing: DrawTiming;
  category: DrawCategory;
  title: string;
  description: string;
}

const TIMINGS: DrawTiming[] = ["completed_this_month", "planned_next_month"];
const CATEGORIES: DrawCategory[] = ["design_dev", "reactive_seo", "anything_else", "writing"];

export async function saveDrawTasks(input: {
  clientKey: string;
  periodKey: string;
  tasks: EditableTask[];
}): Promise<ActionResult> {
  const rows = input.tasks
    .filter((t) => t.title.trim() !== "")
    .map((t) => ({
      client_key: input.clientKey,
      period_key: input.periodKey,
      timing: TIMINGS.includes(t.timing) ? t.timing : "completed_this_month",
      category: CATEGORIES.includes(t.category) ? t.category : "anything_else",
      title: t.title.trim(),
      description: t.description.trim(),
      status: "",
    }));
  const where = await replaceRowsAnywhere(
    "DrawTasks",
    (r) => cell(r.client_key) === input.clientKey && cell(r.period_key) === input.periodKey,
    rows,
  );
  return {
    ok: true,
    message: `Saved ${rows.length} task${rows.length === 1 ? "" : "s"}${where === "sheet" ? " (synced to the Google Sheet)" : ""}. Regenerate the report to apply.`,
  };
}
