import fs from "fs";
import path from "path";
import { loadAdminConfig } from "./sheets";
import { savePages, type EditablePage } from "./pagesEditor";
import { saveGroup } from "./groupEditor";
import { replaceRowsAnywhere, cell } from "./rowStore";
import type { ActionResult } from "./adminActions";
import type { CommercialPriority, ContentType, PageRole } from "./types";

/**
 * One-click load of the agreed targeting plan (Aug 2026 sign-off): key pages
 * with their slider screens, content group URL filters, and topic cluster
 * query filters with synonym expansion. The proposal travels in the repo
 * (data/proposals) keyed by client domain, so it applies to whichever client
 * keys the live database uses.
 *
 * Applying REPLACES the client's key pages, and upserts groups/clusters by
 * name (same name updates in place, other existing groups are left alone).
 */

interface ProposalPage {
  path: string;
  label: string;
  role: string;
  screen: string;
  type: string;
  priority: string;
}

interface ProposalGroup {
  name: string;
  contains: string[];
  notContains: string[];
}

interface ClientProposal {
  pages: ProposalPage[];
  contentGroups: ProposalGroup[];
  topicClusters: ProposalGroup[];
  /** AI visibility prompts (optional per client) */
  aiPrompts?: Array<{ key: string; prompt: string; group?: string; query?: string }>;
}

const PROPOSAL_FILE = path.join(process.cwd(), "data", "proposals", "targeting-2026-08.json");

function loadProposals(): Record<string, ClientProposal> {
  return JSON.parse(fs.readFileSync(PROPOSAL_FILE, "utf8")) as Record<string, ClientProposal>;
}

export async function applyTargeting(clientKey: string): Promise<ActionResult & { detail?: string[] }> {
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return { ok: false, message: "Unknown client." };

  const domain = client.domain.toLowerCase().replace(/^www\./, "");
  const proposal = loadProposals()[domain];
  if (!proposal) {
    return { ok: false, message: `No proposed targeting on file for ${client.domain}.` };
  }

  // Match the host convention the client's existing pages (and so its GSC
  // data) already use; default to the bare domain for fresh clients.
  const hostCounts = new Map<string, number>();
  for (const p of config.clientPages.filter((p) => p.client_key === clientKey)) {
    const m = p.url.match(/^https?:\/\/[^/]+/);
    if (m) hostCounts.set(m[0], (hostCounts.get(m[0]) ?? 0) + 1);
  }
  const host =
    [...hostCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `https://${client.domain.replace(/^www\./, "")}`;

  const pages: EditablePage[] = proposal.pages.map((p) => ({
    url: `${host}${p.path}`,
    label: p.label,
    page_role: p.role as PageRole,
    content_type: (p.type || "commercial") as ContentType,
    commercial_priority: (p.priority || "high") as CommercialPriority,
    page_group: p.screen ?? "",
    active: true,
    notes: "",
  }));
  const pagesResult = await savePages({ clientKey, pages });
  if (!pagesResult.ok) return pagesResult;

  const detail: string[] = [`${pages.length} key pages loaded (previous list replaced).`];
  let groupsOk = 0;
  const failures: string[] = [];
  for (const [kind, groups] of [
    ["content", proposal.contentGroups],
    ["topic", proposal.topicClusters],
  ] as const) {
    for (const g of groups) {
      const result = await saveGroup({
        clientKey,
        kind,
        name: g.name,
        contains: g.contains,
        notContains: g.notContains,
      });
      if (result.ok) groupsOk += 1;
      else failures.push(`${g.name}: ${result.message}`);
    }
  }
  detail.push(`${groupsOk} groups/clusters written (${proposal.contentGroups.length} content, ${proposal.topicClusters.length} topic).`);
  if (failures.length > 0) detail.push(`Failed: ${failures.join("; ")}`);

  if (proposal.aiPrompts && proposal.aiPrompts.length > 0) {
    await replaceRowsAnywhere(
      "AiSearchPrompts",
      (r) => cell(r.client_key) === clientKey,
      proposal.aiPrompts.map((p) => ({
        client_key: clientKey,
        prompt_key: p.key,
        prompt: p.prompt,
        engine: "all",
        market: "gb",
        expected_brand: client.client_name,
        expected_url: `https://${domain}/`,
        priority: "high",
        active: "true",
        prompt_group: p.group ?? "",
        query_override: p.query ?? "",
      })),
    );
    detail.push(`${proposal.aiPrompts.length} AI visibility prompts loaded.`);
  }

  return {
    ok: failures.length === 0,
    message: `Targeting loaded for ${client.client_name}. Regenerate a report to see it applied.`,
    detail,
  };
}

/** Whether a proposal exists for this client (drives the button visibility). */
export async function hasTargetingProposal(clientKey: string): Promise<boolean> {
  try {
    const { config } = await loadAdminConfig();
    const client = config.clients.find((c) => c.client_key === clientKey);
    if (!client) return false;
    return Boolean(loadProposals()[client.domain.toLowerCase().replace(/^www\./, "")]);
  } catch {
    return false;
  }
}
