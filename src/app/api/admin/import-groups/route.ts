import { NextResponse } from "next/server";
import { saveGroup } from "@/lib/groupEditor";
import { replaceRowsAnywhere, cell } from "@/lib/rowStore";
import { slugify } from "@/lib/adminActions";

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
  /** exact-match rules (SEO Gets "equals" filters) — full URLs or queries */
  exact?: string[];
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
      exact: Array.isArray((item as Record<string, unknown>).exact)
        ? ((item as Record<string, unknown>).exact as unknown[]).map(String).filter((s) => s.trim() !== "")
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
    const str = (v: unknown) => String(v ?? "").trim();
    for (const [kind, items] of [
      ["content", contentGroups],
      ["topic", topicClusters],
    ] as const) {
      for (const item of items) {
        let key: string | undefined;
        if (item.contains.length > 0) {
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
            continue;
          }
          key = result.key;
        } else if ((item.exact?.length ?? 0) > 0) {
          // Exact-only group (e.g. a homepage "equals" filter): the editor's
          // save path requires a contains term, so write the group row here.
          key = slugify(item.name);
          const groupTab = kind === "content" ? "ContentGroups" : "TopicClusters";
          const keyField = kind === "content" ? "group_key" : "topic_key";
          const nameField = kind === "content" ? "group_name" : "topic_name";
          await replaceRowsAnywhere(
            groupTab,
            (r) => cell(r.client_key) === clientKey && cell(r[keyField]) === key,
            [{ client_key: clientKey, [keyField]: key, [nameField]: item.name, description: item.description ?? "", active: "true" }],
          );
        } else {
          failures++;
          results.push(`✗ ${kind} "${item.name}": no contains or exact rules — nothing to import.`);
          continue;
        }

        // Exact-match rules (SEO Gets "equals" filters) ride alongside the chips.
        if (key && (item.exact?.length ?? 0) > 0) {
          if (kind === "content") {
            await replaceRowsAnywhere(
              "ContentGroupUrls",
              (r) => cell(r.client_key) === clientKey && cell(r.group_key) === key && str(r.match_type) === "exact",
              item.exact!.map((url) => ({ client_key: clientKey, group_key: key, url, match_type: "exact", active: "true" })),
            );
          } else {
            await replaceRowsAnywhere(
              "TopicClusterRules",
              (r) => cell(r.client_key) === clientKey && cell(r.topic_key) === key && str(r.match_type) === "exact",
              item.exact!.map((q) => ({
                client_key: clientKey,
                topic_key: key,
                match_type: "exact",
                query_text: q,
                case_sensitive: "false",
                active: "true",
              })),
            );
          }
        }
        results.push(
          `✓ ${kind === "content" ? "content group" : "topic cluster"} "${item.name}"${(item.exact?.length ?? 0) > 0 ? ` (+${item.exact!.length} exact rule(s))` : ""}`,
        );
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
