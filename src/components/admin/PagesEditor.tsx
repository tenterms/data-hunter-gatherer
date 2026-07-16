"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DiscoveredPage } from "@/lib/pagesEditor";
import type { CommercialPriority, ContentType, PageRole } from "@/lib/types";

interface Row {
  url: string;
  label: string;
  page_role: PageRole;
  content_type: ContentType;
  commercial_priority: CommercialPriority;
  active: boolean;
  notes: string;
}

const ROLES: PageRole[] = ["primary", "secondary", "supporting", "rest_of_site"];
const TYPES: ContentType[] = ["commercial", "blog", "guide", "sector", "tool", "other"];
const PRIORITIES: CommercialPriority[] = ["high", "medium", "low"];

function labelFromUrl(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
  if (!path) return "Homepage";
  const slug = path.split("/").filter(Boolean).pop() ?? path;
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Key pages editor: the pages that drive the traffic tables and the
 * cannibalisation priorities, with the client's real GSC pages offered as
 * one-click additions.
 */
export default function PagesEditor({
  clientKey,
  configured,
  discovered,
}: {
  clientKey: string;
  configured: Row[];
  discovered: DiscoveredPage[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(configured);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const configuredUrls = new Set(rows.map((r) => r.url.trim().replace(/\/+$/, "").toLowerCase()));
  const addable = discovered.filter(
    (d) => !configuredUrls.has(d.url.trim().replace(/\/+$/, "").toLowerCase()),
  );
  const visibleAddable = showAll ? addable : addable.slice(0, 15);

  function update(index: number, patch: Partial<Row>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addPage(url: string) {
    setRows([
      ...rows,
      {
        url,
        label: labelFromUrl(url),
        page_role: "secondary",
        content_type: "commercial",
        commercial_priority: "medium",
        active: true,
        notes: "",
      },
    ]);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, pages: rows }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage({ ok: data.ok, text: data.message });
      if (data.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="table-wrap">
        <table className="data pages-editor">
          <thead>
            <tr>
              <th>Page</th>
              <th>Label</th>
              <th>Role</th>
              <th>Type</th>
              <th>Priority</th>
              <th aria-label="remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.url}>
                <td className="page-url" title={row.url}>
                  {row.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                </td>
                <td>
                  <input value={row.label} onChange={(e) => update(i, { label: e.target.value })} />
                </td>
                <td>
                  <select value={row.page_role} onChange={(e) => update(i, { page_role: e.target.value as PageRole })}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={row.content_type}
                    onChange={(e) => update(i, { content_type: e.target.value as ContentType })}
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={row.commercial_priority}
                    onChange={(e) => update(i, { commercial_priority: e.target.value as CommercialPriority })}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="row-toggle" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="bars-empty">
                  No key pages yet — add them from the list below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="btn-row" style={{ margin: "12px 0 20px" }}>
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save key pages"}
        </button>
        {message && <span className={`action-msg ${message.ok ? "success" : "error"}`} style={{ margin: 0 }}>{message.text}</span>}
      </div>

      {addable.length > 0 && (
        <>
          <h3>Add from the site&apos;s real pages</h3>
          <p className="section-desc">Sorted by impressions — click Add to track a page in the report.</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Page</th>
                  <th className="num">Clicks</th>
                  <th className="num">Impressions</th>
                  <th aria-label="add" />
                </tr>
              </thead>
              <tbody>
                {visibleAddable.map((d) => (
                  <tr key={d.url}>
                    <td className="page-url" title={d.url}>
                      {d.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                    </td>
                    <td className="num">{d.clicks.toLocaleString("en-GB")}</td>
                    <td className="num">{d.impressions.toLocaleString("en-GB")}</td>
                    <td>
                      <button className="btn" style={{ padding: "3px 10px" }} onClick={() => addPage(d.url)}>
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {addable.length > 15 && (
            <button className="btn" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${addable.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
