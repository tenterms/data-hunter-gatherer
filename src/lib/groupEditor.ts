import fs from "fs";
import path from "path";
import { DATA_DIR, getAppConfig } from "./config";
import { loadAdminConfig } from "./sheets";
import { replaceRowsAnywhere } from "./rowStore";
import { LiveGscAdapter, MockGscAdapter } from "./gsc";
import { clusterMatchesQuery } from "./topicClusters";
import { groupMatchesUrl } from "./contentGroups";
import { listSnapshots, readSnapshot } from "./snapshots";
import { slugify, type ActionResult } from "./adminActions";
import type {
  ClientRow,
  ContentGroupUrlRow,
  GscRow,
  ReportPeriodRow,
  TopicClusterRuleRow,
} from "./types";

/**
 * SEOGets-style in-app editing of topic clusters (query groups) and content
 * groups (URL groups): name + "contains" chips + "doesn't contain" chips, with
 * a live preview of matching GSC rows.
 *
 * Storage stays in the Google Sheet (or mock file), one row per chip:
 *  - include chips  -> match_type "contains"
 *  - exclude chips  -> match_type "not_contains"
 * Rows with advanced match types (exact/regex/starts_with) that were added
 * directly in the sheet are preserved on save and shown as a note in the UI.
 */

export type GroupKind = "topic" | "content";

export interface EditableGroup {
  key: string;
  name: string;
  description: string;
  contains: string[];
  notContains: string[];
  /** rules with advanced match types managed in the sheet, kept on save */
  advancedRules: number;
  active: boolean;
}

export interface EditorData {
  client: ClientRow;
  kind: GroupKind;
  items: EditableGroup[];
  previewPeriodLabel: string | null;
}

// Row replacement (sheet or mock) is shared via rowStore.ts.
const replaceRows = replaceRowsAnywhere;
const str = (v: unknown) => String(v ?? "").trim();

// ---------------------------------------------------------------------------
// Read editor data
// ---------------------------------------------------------------------------

export async function getEditorData(clientKey: string, kind: GroupKind): Promise<EditorData | null> {
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return null;

  let items: EditableGroup[];
  if (kind === "topic") {
    items = config.topicClusters
      .filter((c) => c.client_key === clientKey)
      .map((cluster) => {
        const rules = config.topicClusterRules.filter(
          (r) => r.client_key === clientKey && r.topic_key === cluster.topic_key,
        );
        return {
          key: cluster.topic_key,
          name: cluster.topic_name,
          description: cluster.description,
          contains: rules.filter((r) => r.match_type === "contains").map((r) => r.query_text),
          notContains: rules.filter((r) => r.match_type === "not_contains").map((r) => r.query_text),
          advancedRules: rules.filter((r) => r.match_type === "exact" || r.match_type === "regex").length,
          active: cluster.active,
        };
      });
  } else {
    items = config.contentGroups
      .filter((g) => g.client_key === clientKey)
      .map((group) => {
        const rules = config.contentGroupUrls.filter(
          (r) => r.client_key === clientKey && r.group_key === group.group_key,
        );
        return {
          key: group.group_key,
          name: group.group_name,
          description: group.description,
          contains: rules.filter((r) => r.match_type === "contains").map((r) => r.url),
          notContains: rules.filter((r) => r.match_type === "not_contains").map((r) => r.url),
          advancedRules: rules.filter((r) => r.match_type === "exact" || r.match_type === "starts_with").length,
          active: group.active,
        };
      });
  }

  const preview = await getPreviewRows(clientKey, kind).catch(() => null);
  return { client, kind, items, previewPeriodLabel: preview?.periodLabel ?? null };
}

// ---------------------------------------------------------------------------
// Save / remove
// ---------------------------------------------------------------------------

export async function saveGroup(input: {
  clientKey: string;
  kind: GroupKind;
  key?: string; // omit to create (derived from name)
  name: string;
  description?: string;
  contains: string[];
  notContains: string[];
}): Promise<ActionResult & { key?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the group a name." };
  const contains = input.contains.map((c) => c.trim()).filter(Boolean);
  const notContains = input.notContains.map((c) => c.trim()).filter(Boolean);
  if (contains.length === 0) {
    return { ok: false, message: 'Add at least one "contains" term, otherwise nothing can match.' };
  }
  const key = input.key?.trim() || slugify(name);
  const clientKey = input.clientKey;

  if (input.kind === "topic") {
    await replaceRows(
      "TopicClusters",
      (r) => str(r.client_key) === clientKey && str(r.topic_key) === key,
      [
        {
          client_key: clientKey,
          topic_key: key,
          topic_name: name,
          description: input.description ?? "",
          active: "true",
        },
      ],
    );
    const chipRow = (text: string, matchType: string): Record<string, unknown> => ({
      client_key: clientKey,
      topic_key: key,
      match_type: matchType,
      query_text: text,
      case_sensitive: "false",
      active: "true",
    });
    await replaceRows(
      "TopicClusterRules",
      (r) =>
        str(r.client_key) === clientKey &&
        str(r.topic_key) === key &&
        (str(r.match_type) === "contains" || str(r.match_type) === "not_contains"),
      [...contains.map((c) => chipRow(c, "contains")), ...notContains.map((c) => chipRow(c, "not_contains"))],
    );
  } else {
    await replaceRows(
      "ContentGroups",
      (r) => str(r.client_key) === clientKey && str(r.group_key) === key,
      [
        {
          client_key: clientKey,
          group_key: key,
          group_name: name,
          description: input.description ?? "",
          active: "true",
        },
      ],
    );
    const chipRow = (text: string, matchType: string): Record<string, unknown> => ({
      client_key: clientKey,
      group_key: key,
      url: text,
      match_type: matchType,
      active: "true",
    });
    await replaceRows(
      "ContentGroupUrls",
      (r) =>
        str(r.client_key) === clientKey &&
        str(r.group_key) === key &&
        (str(r.match_type) === "contains" || str(r.match_type) === "not_contains"),
      [...contains.map((c) => chipRow(c, "contains")), ...notContains.map((c) => chipRow(c, "not_contains"))],
    );
  }

  return { ok: true, key, message: `Saved "${name}". Regenerate the report to see it reflected.` };
}

export async function removeGroup(input: {
  clientKey: string;
  kind: GroupKind;
  key: string;
}): Promise<ActionResult> {
  const { clientKey, key } = input;
  if (input.kind === "topic") {
    await replaceRows("TopicClusters", (r) => str(r.client_key) === clientKey && str(r.topic_key) === key, []);
    await replaceRows("TopicClusterRules", (r) => str(r.client_key) === clientKey && str(r.topic_key) === key, []);
  } else {
    await replaceRows("ContentGroups", (r) => str(r.client_key) === clientKey && str(r.group_key) === key, []);
    await replaceRows("ContentGroupUrls", (r) => str(r.client_key) === clientKey && str(r.group_key) === key, []);
  }
  return { ok: true, message: "Removed. Regenerate the report to update it." };
}

// ---------------------------------------------------------------------------
// Live match preview
// ---------------------------------------------------------------------------

interface PreviewSource {
  periodLabel: string;
  queries: GscRow[];
  pages: GscRow[];
}

/**
 * Rows to preview against: the latest snapshot when one exists (instant),
 * otherwise a fresh GSC fetch for the latest configured period, cached on
 * disk so typing in the editor stays responsive.
 */
async function getPreviewRows(clientKey: string, _kind: GroupKind): Promise<PreviewSource | null> {
  const latest = listSnapshots().find((s) => s.clientKey === clientKey);
  if (latest) {
    const snapshot = readSnapshot(clientKey, latest.periodKey);
    if (snapshot) {
      return {
        periodLabel: `${snapshot.period.label} (${snapshot.dataSource} data)`,
        queries: snapshot.raw.gsc.current.queries,
        pages: snapshot.raw.gsc.current.pages,
      };
    }
  }

  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return null;
  const period: ReportPeriodRow | undefined = config.reportPeriods
    .filter((p) => p.client_key === clientKey)
    .sort((a, b) => b.period_key.localeCompare(a.period_key))[0];
  if (!period) return null;

  const cacheFile = path.join(DATA_DIR, "cache", `preview-${clientKey}-${period.period_key}.json`);
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as PreviewSource;
    return cached;
  }

  const app = getAppConfig();
  const adapter = app.hasGoogleCredentials ? new LiveGscAdapter() : new MockGscAdapter(config);
  const dataset = await adapter.fetchDataset(client, {
    startDate: period.start_date,
    endDate: period.end_date,
  });
  const source: PreviewSource = {
    periodLabel: `${period.label} (${adapter.source} data)`,
    queries: dataset.queries,
    pages: dataset.pages,
  };
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(source));
  return source;
}

export interface PreviewResult {
  ok: boolean;
  message: string | null;
  periodLabel: string | null;
  totalMatches: number;
  totalClicks: number;
  totalImpressions: number;
  rows: Array<{ text: string; clicks: number; impressions: number }>;
}

export async function previewMatches(input: {
  clientKey: string;
  kind: GroupKind;
  contains: string[];
  notContains: string[];
}): Promise<PreviewResult> {
  const empty = { totalMatches: 0, totalClicks: 0, totalImpressions: 0, rows: [] };
  const source = await getPreviewRows(input.clientKey, input.kind);
  if (!source) {
    return {
      ok: false,
      message: "No GSC data available to preview against yet — generate a report for this client first.",
      periodLabel: null,
      ...empty,
    };
  }
  const contains = input.contains.map((c) => c.trim()).filter(Boolean);
  const notContains = input.notContains.map((c) => c.trim()).filter(Boolean);
  if (contains.length === 0) {
    return { ok: true, message: null, periodLabel: source.periodLabel, ...empty };
  }

  let matched: GscRow[];
  if (input.kind === "topic") {
    const rules: TopicClusterRuleRow[] = [
      ...contains.map((c) => ({ client_key: "", topic_key: "", match_type: "contains" as const, query_text: c, case_sensitive: false, active: true })),
      ...notContains.map((c) => ({ client_key: "", topic_key: "", match_type: "not_contains" as const, query_text: c, case_sensitive: false, active: true })),
    ];
    matched = source.queries.filter((row) => clusterMatchesQuery(row.keys[0] ?? "", rules));
  } else {
    const rules: ContentGroupUrlRow[] = [
      ...contains.map((c) => ({ client_key: "", group_key: "", url: c, match_type: "contains" as const, active: true })),
      ...notContains.map((c) => ({ client_key: "", group_key: "", url: c, match_type: "not_contains" as const, active: true })),
    ];
    matched = source.pages.filter((row) => groupMatchesUrl(row.keys[0] ?? "", rules));
  }

  matched.sort((a, b) => b.impressions - a.impressions);
  return {
    ok: true,
    message: null,
    periodLabel: source.periodLabel,
    totalMatches: matched.length,
    totalClicks: matched.reduce((s, r) => s + r.clicks, 0),
    totalImpressions: matched.reduce((s, r) => s + r.impressions, 0),
    rows: matched.slice(0, 100).map((r) => ({ text: r.keys[0] ?? "", clicks: r.clicks, impressions: r.impressions })),
  };
}
