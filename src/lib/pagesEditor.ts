import { loadAdminConfig } from "./sheets";
import { replaceRowsAnywhere, cell } from "./rowStore";
import { listSnapshots, readSnapshot } from "./snapshots";
import type { ActionResult } from "./adminActions";
import type { ClientPageRow, ClientRow, CommercialPriority, ContentType, PageRole } from "./types";

/**
 * In-app key-pages editor: assign labels/roles to the pages that drive the
 * traffic tables and the cannibalisation priorities, with the client's real
 * GSC pages (from the latest report) offered as one-click additions.
 */

export interface DiscoveredPage {
  url: string;
  clicks: number;
  impressions: number;
  configured: boolean;
}

export interface PagesEditorData {
  client: ClientRow;
  configured: ClientPageRow[];
  discovered: DiscoveredPage[];
  previewPeriodLabel: string | null;
}

function normaliseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export async function getPagesEditorData(clientKey: string): Promise<PagesEditorData | null> {
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return null;
  const configured = config.clientPages.filter((p) => p.client_key === clientKey);
  const configuredSet = new Set(configured.map((p) => normaliseUrl(p.url)));

  let discovered: DiscoveredPage[] = [];
  let previewPeriodLabel: string | null = null;
  const latest = listSnapshots().find((s) => s.clientKey === clientKey);
  if (latest) {
    const snapshot = readSnapshot(clientKey, latest.periodKey);
    if (snapshot) {
      previewPeriodLabel = `${snapshot.period.label} (${snapshot.dataSource} data)`;
      discovered = snapshot.raw.gsc.current.pages
        .map((r) => ({
          url: r.keys[0] ?? "",
          clicks: r.clicks,
          impressions: r.impressions,
          configured: configuredSet.has(normaliseUrl(r.keys[0] ?? "")),
        }))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 150);
    }
  }
  return { client, configured, discovered, previewPeriodLabel };
}

export interface EditablePage {
  url: string;
  label: string;
  page_role: PageRole;
  content_type: ContentType;
  commercial_priority: CommercialPriority;
  page_group?: string;
  active: boolean;
  notes: string;
}

const ROLES: PageRole[] = ["primary", "secondary", "sector", "supporting", "rest_of_site"];
const TYPES: ContentType[] = ["commercial", "blog", "guide", "sector", "tool", "other"];
const PRIORITIES: CommercialPriority[] = ["high", "medium", "low"];

export async function savePages(input: { clientKey: string; pages: EditablePage[] }): Promise<ActionResult> {
  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  for (const page of input.pages) {
    const url = page.url.trim();
    if (!url) continue;
    const key = normaliseUrl(url);
    if (seen.has(key)) continue; // silently drop duplicates
    seen.add(key);
    rows.push({
      client_key: input.clientKey,
      url,
      label: page.label.trim() || url.replace(/^https?:\/\/[^/]+/, "") || "Homepage",
      page_role: ROLES.includes(page.page_role) ? page.page_role : "secondary",
      content_type: TYPES.includes(page.content_type) ? page.content_type : "other",
      commercial_priority: PRIORITIES.includes(page.commercial_priority) ? page.commercial_priority : "medium",
      active: page.active ? "true" : "false",
      notes: page.notes ?? "",
      page_group: (page.page_group ?? "").trim(),
    });
  }
  const where = await replaceRowsAnywhere(
    "ClientPages",
    (r) => cell(r.client_key) === input.clientKey,
    rows,
  );
  return {
    ok: true,
    message: `Saved ${rows.length} key page${rows.length === 1 ? "" : "s"}${where === "sheet" ? " (synced to the Google Sheet)" : ""}. Regenerate the report to apply.`,
  };
}
