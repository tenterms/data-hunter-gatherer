"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DrawCategory, DrawTaskRow, DrawTiming } from "@/lib/types";

const CATEGORY_LABELS: Record<DrawCategory, string> = {
  design_dev: "Design & Development",
  reactive_seo: "Reactive SEO",
  anything_else: "Anything Else",
  writing: "Writing & Content",
};

const CATEGORY_ORDER: DrawCategory[] = ["design_dev", "reactive_seo", "anything_else", "writing"];

// Row order in the report: priorities first, then last month's work.
const ROWS: Array<{ timing: DrawTiming; label: string }> = [
  { timing: "planned_next_month", label: "Priority Tasks This Month" },
  { timing: "completed_this_month", label: "What We Did Last Month" },
];

function cellText(tasks: DrawTaskRow[], timing: DrawTiming, category: DrawCategory): string {
  return tasks
    .filter((t) => t.timing === timing && t.category === category)
    .map((t) => (t.description ? `${t.title}: ${t.description}` : t.title))
    .join("\n");
}

function CellContent({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return <p className="bars-empty" style={{ margin: 0 }}>—</p>;
  return (
    <ul className="draw-cell-list">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

function EditableCell({
  clientKey,
  periodKey,
  timing,
  category,
  initialText,
}: {
  clientKey: string;
  periodKey: string;
  timing: DrawTiming;
  category: DrawCategory;
  initialText: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/draw-cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, periodKey, timing, category, text }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="draw-cell editing">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.max(4, text.split("\n").length + 1)}
          placeholder="One task per line"
          autoFocus
        />
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button className="btn primary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            className="btn"
            style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => {
              setText(initialText);
              setEditing(false);
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="draw-cell">
      <button className="row-toggle draw-cell-edit" onClick={() => setEditing(true)}>
        edit
      </button>
      <CellContent text={text} />
    </div>
  );
}

/**
 * The monthly DRAW work grid: Priority Tasks This Month and What We Did Last
 * Month, across the four DRAW columns. In team mode every cell is a text box
 * (one task per line) saved straight from the report.
 */
export default function DrawGrid({
  tasks,
  editable,
}: {
  tasks: DrawTaskRow[];
  editable?: { clientKey: string; periodKey: string };
}) {
  if (!editable && tasks.length === 0) {
    return <p className="bars-empty">No work recorded for this period.</p>;
  }
  return (
    <div className="draw-matrix-wrap">
      <table className="draw-matrix">
        <thead>
          <tr>
            <th aria-label="row" />
            {CATEGORY_ORDER.map((c) => (
              <th key={c}>{CATEGORY_LABELS[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.timing}>
              <th className="draw-row-label">{row.label}</th>
              {CATEGORY_ORDER.map((category) => {
                const text = cellText(tasks, row.timing, category);
                return (
                  <td key={category}>
                    {editable ? (
                      <EditableCell
                        clientKey={editable.clientKey}
                        periodKey={editable.periodKey}
                        timing={row.timing}
                        category={category}
                        initialText={text}
                      />
                    ) : (
                      <CellContent text={text} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
