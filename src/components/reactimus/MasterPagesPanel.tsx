"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MasterPageRow } from "@/lib/types";

/**
 * Master page list editor. Rows are grouped by "Section of site", then by
 * "Close group" within a section — and the grouping is live: changing a
 * row's section or close group moves it into that group immediately, so the
 * list physically re-sorts as it's organised.
 */

interface Props {
  clientKey: string;
  initialRows: MasterPageRow[];
  domain: string;
}

const shortPath = (url: string) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/reactimus/master", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    log?: string[];
  };
  return { ok: res.ok && data.ok !== false, message: data.message ?? "", log: data.log ?? [] };
}

export default function MasterPagesPanel({ clientKey, initialRows, domain }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<MasterPageRow[]>(initialRows);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"scan" | "save" | null>(null);
  const [message, setMessage] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const sections = useMemo(() => {
    const map = new Map<string, Map<string, MasterPageRow[]>>();
    for (const row of rows.filter((r) => r.active)) {
      const section = row.section.trim() || "Unsorted";
      const group = row.close_group.trim();
      const groups = map.get(section) ?? new Map<string, MasterPageRow[]>();
      const list = groups.get(group) ?? [];
      list.push(row);
      groups.set(group, list);
      map.set(section, groups);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([section, groups]) => ({
        section,
        groups: [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      }));
  }, [rows]);

  const sectionNames = useMemo(
    () => [...new Set(rows.map((r) => r.section.trim()).filter(Boolean))].sort(),
    [rows],
  );
  const groupNames = useMemo(
    () => [...new Set(rows.map((r) => r.close_group.trim()).filter(Boolean))].sort(),
    [rows],
  );

  const edit = (url: string, field: "primary_keyword" | "section" | "close_group", value: string) => {
    setRows((prev) => prev.map((r) => (r.url === url ? { ...r, [field]: value } : r)));
    setDirty(true);
  };
  const toggleActive = (url: string) => {
    setRows((prev) => prev.map((r) => (r.url === url ? { ...r, active: !r.active } : r)));
    setDirty(true);
  };

  const scan = async () => {
    setBusy("scan");
    setMessage("Scanning the site — this fetches every page in the sitemap, so it can take a few minutes …");
    setLog([]);
    const result = await post({ clientKey, action: "scan" });
    setMessage(result.message);
    setLog(result.log);
    setBusy(null);
    router.refresh();
    if (result.ok) window.location.reload();
  };

  const save = async () => {
    setBusy("save");
    const result = await post({
      clientKey,
      action: "save",
      rows: rows.map((r) => ({
        url: r.url,
        primary_keyword: r.primary_keyword,
        section: r.section,
        close_group: r.close_group,
        active: r.active,
      })),
    });
    setMessage(result.message);
    setDirty(!result.ok);
    setBusy(null);
    router.refresh();
  };

  const hidden = rows.filter((r) => !r.active);

  return (
    <>
      <div className="card">
        <p style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: 0 }}>
          <button className="btn" onClick={scan} disabled={busy !== null}>
            {busy === "scan" ? "Scanning…" : rows.length > 0 ? "Rescan site" : `Scan ${domain}`}
          </button>
          <button className="btn" onClick={save} disabled={busy !== null || !dirty}>
            {busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          {message && <span className="meta">{message}</span>}
        </p>
        {rows.length > 0 && (
          <p className="meta" style={{ marginBottom: 0 }}>
            {rows.filter((r) => r.active).length} pages · rescanning keeps your keywords and groups,
            refreshes titles, and picks up new pages.
          </p>
        )}
        {log.length > 0 && (
          <pre className="test-output" style={{ maxHeight: 180, overflow: "auto" }}>
            {log.join("\n")}
          </pre>
        )}
      </div>

      {sections.map(({ section, groups }) => (
        <div className="card" key={section}>
          <h2>{section}</h2>
          {groups.map(([groupName, groupRows]) => (
            <div key={groupName || "(ungrouped)"} className={groupName ? "nested-box" : undefined}>
              {groupName && (
                <h3 className="master-group-title">
                  {groupName} <span className="meta">close group · pages link to each other</span>
                </h3>
              )}
              <div className="scroll-x">
                <table className="reactimus-table master-table">
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th>Primary keyword</th>
                      <th>Section</th>
                      <th>Close group</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows
                      .sort((a, b) => a.url.localeCompare(b.url))
                      .map((row) => (
                        <tr key={row.url}>
                          <td className="master-page-cell">
                            <a href={row.url} target="_blank" rel="noreferrer">
                              {shortPath(row.url)}
                            </a>
                            <span className="meta">{row.h1 || row.title}</span>
                          </td>
                          <td>
                            <input
                              value={row.primary_keyword}
                              onChange={(e) => edit(row.url, "primary_keyword", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              value={row.section}
                              list="master-sections"
                              onChange={(e) => edit(row.url, "section", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              value={row.close_group}
                              list="master-groups"
                              placeholder="—"
                              onChange={(e) => edit(row.url, "close_group", e.target.value)}
                            />
                          </td>
                          <td>
                            <button className="btn btn-subtle" onClick={() => toggleActive(row.url)}>
                              Hide
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}

      {hidden.length > 0 && (
        <div className="card reactimus-archive">
          <details>
            <summary>Hidden pages ({hidden.length}) — excluded from analysis and site awareness</summary>
            <ul className="reactimus-archive-list">
              {hidden.map((row) => (
                <li key={row.url}>
                  <span>
                    {shortPath(row.url)} <span className="meta">{row.title}</span>
                  </span>
                  <button className="btn btn-subtle" onClick={() => toggleActive(row.url)}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <datalist id="master-sections">
        {sectionNames.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="master-groups">
        {groupNames.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </>
  );
}
