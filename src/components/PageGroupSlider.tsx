"use client";

import { useState } from "react";
import type { PagePerformance } from "@/lib/types";
import PagesTable from "./PagesTable";

/**
 * The traffic tables' page groups behind prev/next controls, same pattern as
 * the rankings engine switcher. Clients with several substantial sets (like
 * AAG's location and sector pages) get one screen per set instead of a long
 * stack of tables; with a single set it renders as a plain heading + table.
 */
export default function PageGroupSlider({
  groups,
}: {
  groups: Array<{ label: string; pages: PagePerformance[] }>;
}) {
  const list = groups.filter((g) => g.pages.length > 0);
  const [index, setIndex] = useState(0);

  if (list.length === 0) return null;
  if (list.length === 1) {
    return (
      <>
        <h3>{list[0].label}</h3>
        <PagesTable pages={list[0].pages} />
      </>
    );
  }

  const safeIndex = Math.min(index, list.length - 1);
  const current = list[safeIndex];
  return (
    <div>
      <div className="engine-switcher">
        <button
          type="button"
          className="btn"
          onClick={() => setIndex((safeIndex - 1 + list.length) % list.length)}
        >
          ‹ Prev
        </button>
        <span className="engine-label">
          <strong>{current.label}</strong> · {current.pages.length} page
          {current.pages.length === 1 ? "" : "s"} · {safeIndex + 1} of {list.length}
        </span>
        <button type="button" className="btn" onClick={() => setIndex((safeIndex + 1) % list.length)}>
          Next ›
        </button>
      </div>
      <PagesTable pages={current.pages} />
    </div>
  );
}
