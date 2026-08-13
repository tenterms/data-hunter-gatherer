import fs from "fs";
import path from "path";
import { REPORTS_DIR } from "./config";
import { loadAdminConfig } from "./sheets";
import { replaceRowsAnywhere, cell } from "./rowStore";
import type { ActionResult } from "./adminActions";
import type { ClientRow, ReportSnapshot } from "./types";

/**
 * Report display settings, managed from the admin panel:
 *  - search engine order/visibility/labels for the SE Ranking slider
 *  - which cannibalisation rows are shown to the client
 *
 * Saves write the config rows (applied on every future generate) AND patch the
 * client's existing draft snapshots so the team view updates immediately.
 * Published copies stay frozen until "Publish update" is clicked.
 */

const SAFE = /^[a-z0-9_-]+$/i;

function draftFiles(clientKey: string): string[] {
  if (!SAFE.test(clientKey)) return [];
  const dir = path.join(REPORTS_DIR, clientKey);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".published.json"))
    .map((f) => path.join(dir, f));
}

function patchDrafts(clientKey: string, patch: (snapshot: ReportSnapshot) => void): number {
  let patched = 0;
  for (const file of draftFiles(clientKey)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(file, "utf8")) as ReportSnapshot;
      patch(snapshot);
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
      patched += 1;
    } catch {
      // an unreadable snapshot shouldn't block saving the settings
    }
  }
  return patched;
}

function latestDraft(clientKey: string): ReportSnapshot | null {
  const files = draftFiles(clientKey).sort().reverse(); // period keys sort chronologically
  for (const file of files) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as ReportSnapshot;
    } catch {
      // try the next one
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data for the settings page
// ---------------------------------------------------------------------------

export interface EngineSetting {
  id: string;
  label: string;
  defaultLabel: string;
  active: boolean;
  keywordsTracked: number;
}

export interface CannibalisationSetting {
  query: string;
  pageCount: number;
  clicks: number;
  impressions: number;
  hidden: boolean;
}

export interface ReportSettingsData {
  client: ClientRow;
  latestPeriodLabel: string | null;
  engines: EngineSetting[];
  cannibalisation: CannibalisationSetting[];
}

export async function getReportSettingsData(clientKey: string): Promise<ReportSettingsData | null> {
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return null;

  const snapshot = latestDraft(clientKey);
  const engineRows = config.rankingEngines.filter((e) => e.client_key === clientKey);

  // Engines known from the latest snapshot (id + default label + size)…
  const engines: EngineSetting[] = (snapshot?.metrics.rankingEngines ?? []).map((e) => {
    const row = engineRows.find((r) => r.engine_id === e.id);
    return {
      id: e.id,
      label: row?.label || e.label,
      defaultLabel: e.label,
      active: row ? row.active : true,
      keywordsTracked: e.summary.keywordsTracked,
    };
  });
  // …plus any configured engine the snapshot doesn't have (kept so its setting isn't lost).
  for (const row of engineRows) {
    if (!engines.some((e) => e.id === row.engine_id)) {
      engines.push({
        id: row.engine_id,
        label: row.label || row.engine_id,
        defaultLabel: row.label || row.engine_id,
        active: row.active,
        keywordsTracked: 0,
      });
    }
  }
  engines.sort((a, b) => {
    const orderFor = (id: string) =>
      engineRows.find((r) => r.engine_id === id)?.sort_order ?? Number.MAX_SAFE_INTEGER;
    return orderFor(a.id) - orderFor(b.id);
  });

  const visible = new Set(
    config.cannibalisationVisible
      .filter((e) => e.client_key === clientKey)
      .map((e) => e.query.toLowerCase()),
  );
  const cannibalisation: CannibalisationSetting[] = (snapshot?.metrics.cannibalisation ?? []).map((i) => ({
    query: i.query,
    pageCount: i.pageCount,
    clicks: i.clicks,
    impressions: i.impressions,
    hidden: !visible.has(i.query.toLowerCase()),
  }));

  return {
    client,
    latestPeriodLabel: snapshot?.period.label ?? null,
    engines,
    cannibalisation,
  };
}

// ---------------------------------------------------------------------------
// Saves
// ---------------------------------------------------------------------------

export async function saveRankingEngines(input: {
  clientKey: string;
  engines: Array<{ id: string; label: string; active: boolean }>;
}): Promise<ActionResult> {
  const engines = input.engines.filter((e) => e.id.trim() !== "");
  const rows = engines.map((e, index) => ({
    client_key: input.clientKey,
    engine_id: e.id.trim(),
    label: e.label.trim(),
    sort_order: index,
    active: e.active,
  }));
  const where = await replaceRowsAnywhere(
    "RankingEngines",
    (r) => cell(r.client_key) === input.clientKey,
    rows,
  );

  // Reorder / relabel / re-flag the engines already stored in draft snapshots.
  const orderFor = new Map(engines.map((e, i) => [e.id, i]));
  const settingFor = new Map(engines.map((e) => [e.id, e]));
  patchDrafts(input.clientKey, (snapshot) => {
    const list = snapshot.metrics.rankingEngines;
    if (!list || list.length === 0) return;
    list.sort(
      (a, b) =>
        (orderFor.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderFor.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    for (const engine of list) {
      const setting = settingFor.get(engine.id);
      if (!setting) continue;
      if (setting.label.trim() !== "") engine.label = setting.label.trim();
      engine.hidden = setting.active ? undefined : true;
    }
  });

  return {
    ok: true,
    message: `Saved search engine order${where === "sheet" ? " (synced to the Google Sheet)" : ""}. The report pages update straight away; republish to update client links.`,
  };
}

export async function saveCannibalisationVisibility(input: {
  clientKey: string;
  visibleQueries: string[];
}): Promise<ActionResult> {
  const shown = [...new Set(input.visibleQueries.map((q) => q.trim()).filter((q) => q !== ""))];
  const rows = shown.map((query) => ({ client_key: input.clientKey, query }));
  const where = await replaceRowsAnywhere(
    "CannibalisationVisible",
    (r) => cell(r.client_key) === input.clientKey,
    rows,
  );

  const shownSet = new Set(shown.map((q) => q.toLowerCase()));
  patchDrafts(input.clientKey, (snapshot) => {
    for (const issue of snapshot.metrics.cannibalisation) {
      issue.hidden = shownSet.has(issue.query.toLowerCase()) ? undefined : true;
    }
  });

  return {
    ok: true,
    message: `${shown.length} quer${shown.length === 1 ? "y" : "ies"} shown in the report (everything else stays hidden)${where === "sheet" ? " (synced to the Google Sheet)" : ""}. The report pages update straight away; republish to update client links.`,
  };
}
