"use client";

import type { RankingMovement, RankingSummary } from "@/lib/types";
import DataTable, { type Column } from "./DataTable";

function MovementLabel({ m }: { m: RankingMovement }) {
  switch (m.direction) {
    case "entered":
      return <span className="change-positive">entered</span>;
    case "dropped":
      return <span className="change-negative">dropped</span>;
    case "up":
      return <span className="change-positive">↑ {m.change}</span>;
    case "down":
      return <span className="change-negative">↓ {Math.abs(m.change ?? 0)}</span>;
    default:
      return <span className="change-neutral">→ 0</span>;
  }
}

const columns: Column<RankingMovement>[] = [
  { key: "keyword", header: "Keyword", sortValue: (m) => m.keyword, render: (m) => m.keyword },
  {
    key: "start",
    header: "Start pos",
    numeric: true,
    sortValue: (m) => m.startPosition ?? 999,
    render: (m) => m.startPosition ?? "–",
  },
  {
    key: "end",
    header: "End pos",
    numeric: true,
    sortValue: (m) => m.endPosition ?? 999,
    render: (m) => m.endPosition ?? "–",
  },
  {
    key: "change",
    header: "Change",
    numeric: true,
    sortValue: (m) =>
      m.direction === "entered" ? 1000 : m.direction === "dropped" ? -1000 : (m.change ?? 0),
    render: (m) => <MovementLabel m={m} />,
  },
  {
    key: "volume",
    header: "Volume",
    numeric: true,
    sortValue: (m) => m.searchVolume ?? 0,
    render: (m) => (m.searchVolume === null ? "–" : m.searchVolume.toLocaleString("en-GB")),
  },
];

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="kpi-card">
      <div className="label">{label}</div>
      <div className={`value${tone ? ` change-${tone}` : ""}`} style={{ fontSize: 24 }}>
        {value}
      </div>
    </div>
  );
}

export default function RankingsSection({ summary }: { summary: RankingSummary }) {
  if (summary.source === "unavailable" || summary.keywordsTracked === 0) {
    return (
      <p className="bars-empty">
        No ranking data for this period. Import an SE Ranking CSV with{" "}
        <code>npm run import-rankings-csv</code> or add rows to the RankingImports sheet tab.
      </p>
    );
  }
  return (
    <div>
      <div className="kpi-grid">
        <Stat label="Tracked keywords" value={String(summary.keywordsTracked)} />
        <Stat label="Positions up" value={String(summary.positionsUp)} tone="positive" />
        <Stat label="Positions down" value={String(summary.positionsDown)} tone="negative" />
        <Stat label="Top 3" value={`${summary.top3.previous} → ${summary.top3.current}`} />
        <Stat label="Top 10" value={`${summary.top10.previous} → ${summary.top10.current}`} />
        <Stat label="Top 30" value={`${summary.top30.previous} → ${summary.top30.current}`} />
        {summary.visibilityScore !== null && <Stat label="Visibility" value={`${summary.visibilityScore}%`} />}
      </div>
      <p className="section-desc">
        Keyword movements ({summary.source.replace(/_/g, " ")} data)
        {summary.entered > 0 && ` · ${summary.entered} entered`}
        {summary.dropped > 0 && ` · ${summary.dropped} dropped`}
      </p>
      <DataTable columns={columns} rows={summary.movements} rowKey={(m) => m.keyword} defaultSortKey="change" />
    </div>
  );
}
