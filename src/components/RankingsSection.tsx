"use client";

import { useState } from "react";
import type { RankingEngineData, RankingMovement, RankingSummary } from "@/lib/types";
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

function SummaryPanel({ summary }: { summary: RankingSummary }) {
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
      <div className="scroll-box">
        <DataTable
          columns={columns}
          rows={summary.movements}
          rowKey={(m) => m.keyword}
          defaultSortKey="end"
          defaultDescending={false}
        />
      </div>
    </div>
  );
}

/**
 * Visibility section. When SE Ranking supplies several search engines
 * (e.g. one per target location), each gets its own panel behind
 * prev/next controls; the order and labels come from the admin panel.
 */
export default function RankingsSection({
  summary,
  engines,
}: {
  summary: RankingSummary;
  engines?: RankingEngineData[];
}) {
  const visibleEngines = (engines ?? []).filter((e) => !e.hidden);
  const list = visibleEngines.length > 0 ? visibleEngines : null;
  const [index, setIndex] = useState(0);

  if (!list) {
    if (summary.source === "unavailable" || summary.keywordsTracked === 0) {
      return (
        <p className="bars-empty">
          No ranking data for this period. Connect SE Ranking (SERANKING_API_KEY) or import a rankings
          CSV from the client&apos;s admin page.
        </p>
      );
    }
    return <SummaryPanel summary={summary} />;
  }

  const safeIndex = Math.min(index, list.length - 1);
  const current = list[safeIndex];
  return (
    <div>
      {list.length > 1 ? (
        <div className="engine-switcher">
          <button
            type="button"
            className="btn"
            onClick={() => setIndex((safeIndex - 1 + list.length) % list.length)}
          >
            ‹ Prev
          </button>
          <span className="engine-label">
            <strong>{current.label}</strong> · {safeIndex + 1} of {list.length}
          </span>
          <button type="button" className="btn" onClick={() => setIndex((safeIndex + 1) % list.length)}>
            Next ›
          </button>
        </div>
      ) : (
        <p className="section-desc">{current.label}</p>
      )}
      <SummaryPanel summary={current.summary} />
    </div>
  );
}
