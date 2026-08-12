import { NextResponse } from "next/server";
import { saveGroup } from "@/lib/groupEditor";

/**
 * Bulk import of content groups and topic clusters for one client, used to
 * bring definitions across from SEO Gets (or any other source). The payload
 * carries both kinds; each item becomes one group via the same code path as
 * the in-app editor, so keys, storage and report generation behave exactly
 * as if the groups had been typed in by hand.
 *
 * Shape:
 * {
 *   clientKey: "aag",
 *   contentGroups: [{ name, contains: [..], notContains?: [..], description? }],
 *   topicClusters: [{ name, contains: [..], notContains?: [..], description? }]
 * }
 */

interface ImportItem {
  name: string;
  contains: string[];
  notContains?: string[];
  description?: string;
}

function parseItems(value: unknown): ImportItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      name: String((item as Record<string, unknown>).name ?? "").trim(),
      contains: Array.isArray((item as Record<string, unknown>).contains)
        ? ((item as Record<string, unknown>).contains as unknown[]).map(String)
        : [],
      notContains: Array.isArray((item as Record<string, unknown>).notContains)
        ? ((item as Record<string, unknown>).notContains as unknown[]).map(String)
        : [],
      description: String((item as Record<string, unknown>).description ?? ""),
    }))
    .filter((item) => item.name !== "");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const clientKey = String(body.clientKey ?? "").trim();
    if (!clientKey) {
      return NextResponse.json({ ok: false, message: "Missing clientKey." }, { status: 400 });
    }
    const contentGroups = parseItems(body.contentGroups);
    const topicClusters = parseItems(body.topicClusters);
    if (contentGroups.length === 0 && topicClusters.length === 0) {
      return NextResponse.json(
        { ok: false, message: "Nothing to import — provide contentGroups and/or topicClusters." },
        { status: 400 },
      );
    }

    const results: string[] = [];
    let failures = 0;
    for (const [kind, items] of [
      ["content", contentGroups],
      ["topic", topicClusters],
    ] as const) {
      for (const item of items) {
        const result = await saveGroup({
          clientKey,
          kind,
          name: item.name,
          description: item.description,
          contains: item.contains,
          notContains: item.notContains ?? [],
        });
        if (!result.ok) {
          failures++;
          results.push(`✗ ${kind} "${item.name}": ${result.message}`);
        } else {
          results.push(`✓ ${kind === "content" ? "content group" : "topic cluster"} "${item.name}"`);
        }
      }
    }

    return NextResponse.json({
      ok: failures === 0,
      message: `Imported ${contentGroups.length + topicClusters.length - failures} group(s)${failures ? `, ${failures} failed` : ""}. Regenerate the report to see them.`,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Import failed." },
      { status: 500 },
    );
  }
}
