"use client";

import type { PagePerformance } from "@/lib/types";
import DataTable, { type Column } from "./DataTable";
import ChangeBadge from "./ChangeBadge";

function fmt(n: number): string {
  return n.toLocaleString("en-GB");
}

const columns: Column<PagePerformance>[] = [
  {
    key: "label",
    header: "Page",
    sortValue: (p) => p.label,
    render: (p) => (
      <>
        <a href={p.url} target="_blank" rel="noreferrer">
          {p.label}
        </a>
      </>
    ),
  },
  {
    key: "clicks",
    header: "Clicks",
    numeric: true,
    sortValue: (p) => p.current.clicks,
    render: (p) => (
      <>
        {fmt(p.current.clicks)} <ChangeBadge comparison={p.comparison.clicks} />
      </>
    ),
  },
  {
    key: "prevClicks",
    header: "Prev clicks",
    numeric: true,
    sortValue: (p) => p.previous.clicks,
    render: (p) => fmt(p.previous.clicks),
  },
  {
    key: "impressions",
    header: "Impressions",
    numeric: true,
    sortValue: (p) => p.current.impressions,
    render: (p) => (
      <>
        {fmt(p.current.impressions)} <ChangeBadge comparison={p.comparison.impressions} />
      </>
    ),
  },
  {
    key: "prevImpressions",
    header: "Prev impr.",
    numeric: true,
    sortValue: (p) => p.previous.impressions,
    render: (p) => fmt(p.previous.impressions),
  },
  {
    key: "ctr",
    header: "CTR",
    numeric: true,
    sortValue: (p) => p.current.ctr,
    render: (p) => `${(p.current.ctr * 100).toFixed(2)}%`,
  },
  {
    key: "position",
    header: "Avg pos",
    numeric: true,
    sortValue: (p) => p.current.position ?? 999,
    render: (p) => (p.current.position === null ? "–" : p.current.position.toFixed(1)),
  },
];

export default function PagesTable({ pages }: { pages: PagePerformance[] }) {
  if (pages.length === 0) return <p className="bars-empty">No pages configured for this section.</p>;
  return <DataTable columns={columns} rows={pages} rowKey={(p) => p.url} defaultSortKey="clicks" />;
}
