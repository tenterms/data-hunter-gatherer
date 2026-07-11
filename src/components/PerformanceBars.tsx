"use client";

import { useState } from "react";
import type { GroupPerformance, GrowthMetric } from "@/lib/types";

type Filter = "all" | "growing" | "decaying";

/**
 * Simple horizontal bars for content groups / topic clusters, styled after the
 * existing internal tooling: label sits inside a light bar sized by the metric,
 * with the value and a red/green change on the right. Tabs filter All /
 * Growing / Decaying; the metric selector switches clicks/impressions.
 */
export default function PerformanceBars({ groups }: { groups: GroupPerformance[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [metric, setMetric] = useState<GrowthMetric>("clicks");

  const visible = groups.filter((g) => filter === "all" || g.status === filter);
  const max = Math.max(1, ...groups.map((g) => g.current[metric]));

  return (
    <div>
      <div className="bars-header">
        <div className="tab-row" role="tablist">
          {(["all", "growing", "decaying"] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "growing" ? "Growing" : "Decaying"}
            </button>
          ))}
        </div>
        <div className="metric-toggle">
          <button className={metric === "clicks" ? "active" : ""} onClick={() => setMetric("clicks")}>
            Clicks
          </button>
          <span aria-hidden> · </span>
          <button
            className={metric === "impressions" ? "active" : ""}
            onClick={() => setMetric("impressions")}
          >
            Impressions
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="bars-empty">Nothing {filter} this period.</p>
      ) : (
        visible.map((g) => {
          const value = g.current[metric];
          const comparison = g.comparison[metric];
          const width = Math.max(4, (value / max) * 100);
          const changeEl = comparison.isNew ? (
            <span className="delta change-positive">↑ new</span>
          ) : comparison.changePct === null || comparison.changePct === 0 ? (
            <span className="delta change-neutral">→ 0%</span>
          ) : comparison.changePct > 0 ? (
            <span className="delta change-positive">↑ {Math.abs(comparison.changePct * 100).toFixed(0)}%</span>
          ) : (
            <span className="delta change-negative">↓ {Math.abs(comparison.changePct * 100).toFixed(0)}%</span>
          );
          return (
            <div className="bar-row" key={g.key} title={g.description || g.name}>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${width}%` }} />
                <span className="bar-label">{g.name}</span>
              </div>
              <div className="bar-value">
                {value.toLocaleString("en-GB")}
                {changeEl}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
