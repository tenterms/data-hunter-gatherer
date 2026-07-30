"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CannibalisationIssue } from "@/lib/types";
import DataTable, { type Column } from "./DataTable";

function fmt(n: number): string {
  return n.toLocaleString("en-GB");
}

const baseColumns: Column<CannibalisationIssue>[] = [
  { key: "query", header: "Query", sortValue: (i) => i.query, render: (i) => i.query },
  { key: "pages", header: "Pages", numeric: true, sortValue: (i) => i.pageCount, render: (i) => i.pageCount },
  { key: "clicks", header: "Clicks", numeric: true, sortValue: (i) => i.clicks, render: (i) => fmt(i.clicks) },
  {
    key: "impressions",
    header: "Impressions",
    numeric: true,
    sortValue: (i) => i.impressions,
    render: (i) => fmt(i.impressions),
  },
  {
    key: "ctr",
    header: "CTR",
    numeric: true,
    sortValue: (i) => i.ctr,
    render: (i) => `${(i.ctr * 100).toFixed(1)}%`,
  },
  {
    key: "position",
    header: "Position",
    numeric: true,
    sortValue: (i) => i.position ?? 999,
    render: (i) => (i.position === null ? "–" : i.position.toFixed(1)),
  },
  {
    key: "priority",
    header: "Priority",
    numeric: true,
    sortValue: (i) => i.priorityScore,
    render: (i) => <span className={`badge flag-${i.priorityFlag}`}>{i.priorityFlag}</span>,
  },
];

/**
 * Cannibalisation table. With `curation` set (team report view), every row —
 * including hidden ones, shown dimmed — gets a shown/hidden toggle that saves
 * immediately; the client view only ever receives the visible rows.
 */
export default function CannibalisationTable({
  issues,
  curation,
}: {
  issues: CannibalisationIssue[];
  curation?: { clientKey: string };
}) {
  const router = useRouter();
  const [hiddenOverride, setHiddenOverride] = useState<Record<string, boolean>>({});
  const [savingQuery, setSavingQuery] = useState<string | null>(null);

  if (issues.length === 0) {
    return <p className="bars-empty">No queries with more than one page receiving impressions — nothing to fix here.</p>;
  }

  const isHidden = (issue: CannibalisationIssue) => hiddenOverride[issue.query] ?? !!issue.hidden;

  async function toggle(issue: CannibalisationIssue) {
    if (!curation) return;
    const nextHiddenList = issues
      .filter((i) => (i.query === issue.query ? !isHidden(i) : isHidden(i)))
      .map((i) => i.query);
    setHiddenOverride((prev) => ({ ...prev, [issue.query]: !isHidden(issue) }));
    setSavingQuery(issue.query);
    try {
      await fetch("/api/admin/cannibalisation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: curation.clientKey, hiddenQueries: nextHiddenList }),
      });
      router.refresh();
    } finally {
      setSavingQuery(null);
    }
  }

  const columns: Column<CannibalisationIssue>[] = curation
    ? [
        ...baseColumns,
        {
          key: "visible",
          header: "In report?",
          numeric: true,
          sortValue: (i) => (isHidden(i) ? 0 : 1),
          render: (i) => (
            <button
              className={`row-toggle ${isHidden(i) ? "off" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(i);
              }}
              disabled={savingQuery === i.query}
            >
              {savingQuery === i.query ? "…" : isHidden(i) ? "hidden" : "shown"}
            </button>
          ),
        },
      ]
    : baseColumns;

  return (
    <DataTable
      columns={columns}
      rows={issues}
      rowKey={(i) => i.query}
      defaultSortKey="priority"
      rowClassName={curation ? (i) => (isHidden(i) ? "row-dimmed" : "") : undefined}
      expandable={(issue) => (
        <table className="sub-table">
          <tbody>
            {issue.pages.map((p) => (
              <tr key={p.url}>
                <td>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}
                  </a>
                  {p.pageRole === "primary" || p.commercialPriority === "high" ? (
                    <span className="badge flag-high" style={{ marginLeft: 8 }}>
                      {p.pageRole === "primary" ? "primary" : "high priority"}
                    </span>
                  ) : null}
                </td>
                <td className="num">{fmt(p.clicks)} clicks</td>
                <td className="num">{fmt(p.impressions)} impr.</td>
                <td className="num">{(p.ctr * 100).toFixed(1)}% CTR</td>
                <td className="num">pos {p.position === null ? "–" : p.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}
