"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DrawCategory, DrawTiming } from "@/lib/types";

interface Task {
  timing: DrawTiming;
  category: DrawCategory;
  title: string;
  description: string;
}

interface MonthData {
  periodKey: string;
  label: string;
  tasks: Task[];
}

const CATEGORY_LABELS: Record<DrawCategory, string> = {
  design_dev: "Design & Development",
  reactive_seo: "Reactive SEO",
  anything_else: "Anything Else",
  writing: "Writing & Content",
};

const TIMING_LABELS: Record<DrawTiming, string> = {
  planned_next_month: "Priority task",
  completed_this_month: "What we did",
};

/**
 * Two-month work grid editor: this month and last month in one place, with a
 * per-task "→ last month" button for the monthly roll-over. Saving writes
 * both months' task lists.
 */
export default function DrawMonthsEditor({
  clientKey,
  thisMonth,
  lastMonth,
}: {
  clientKey: string;
  thisMonth: MonthData;
  lastMonth: MonthData | null;
}) {
  const router = useRouter();
  const [thisTasks, setThisTasks] = useState<Task[]>(thisMonth.tasks);
  const [lastTasks, setLastTasks] = useState<Task[]>(lastMonth?.tasks ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function moveToLastMonth(index: number) {
    const task = thisTasks[index];
    setThisTasks(thisTasks.filter((_, i) => i !== index));
    // A task rolled back a month was work that got done, so it lands as completed.
    setLastTasks([...lastTasks, { ...task, timing: "completed_this_month" }]);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const post = (periodKey: string, tasks: Task[]) =>
        fetch("/api/admin/draw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientKey, periodKey, tasks }),
        }).then((r) => r.json() as Promise<{ ok: boolean; message: string }>);

      const first = await post(thisMonth.periodKey, thisTasks);
      const second = lastMonth ? await post(lastMonth.periodKey, lastTasks) : { ok: true, message: "" };
      const ok = first.ok && second.ok;
      setMessage({
        ok,
        text: ok
          ? "Saved both months. Regenerate the report(s) to apply."
          : [first, second].find((r) => !r.ok)?.message ?? "Save failed.",
      });
      if (ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const monthCard = (
    title: string,
    tasks: Task[],
    setTasks: (tasks: Task[]) => void,
    options: { canMoveDown: boolean },
  ) => {
    const update = (index: number, patch: Partial<Task>) =>
      setTasks(tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)));

    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {tasks.map((task, i) => (
          <div className="draw-month-row" key={i}>
            <select
              value={task.timing}
              onChange={(e) => update(i, { timing: e.target.value as DrawTiming })}
            >
              {(Object.keys(TIMING_LABELS) as DrawTiming[]).map((t) => (
                <option key={t} value={t}>
                  {TIMING_LABELS[t]}
                </option>
              ))}
            </select>
            <select
              value={task.category}
              onChange={(e) => update(i, { category: e.target.value as DrawCategory })}
            >
              {(Object.keys(CATEGORY_LABELS) as DrawCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <input
              placeholder="Task title"
              value={task.title}
              onChange={(e) => update(i, { title: e.target.value })}
            />
            <input
              placeholder="Short description (optional)"
              value={task.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
            <span className="draw-month-actions">
              {options.canMoveDown && (
                <button className="row-toggle" title="Move to last month" onClick={() => moveToLastMonth(i)}>
                  → last month
                </button>
              )}
              <button className="row-toggle off" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>
                remove
              </button>
            </span>
          </div>
        ))}
        <button
          className="btn"
          style={{ marginTop: 8 }}
          onClick={() =>
            setTasks([
              ...tasks,
              { timing: "completed_this_month", category: "reactive_seo", title: "", description: "" },
            ])
          }
        >
          + Add task
        </button>
      </div>
    );
  };

  return (
    <div>
      {monthCard(`This month — ${thisMonth.label}`, thisTasks, setThisTasks, {
        canMoveDown: lastMonth !== null,
      })}
      {lastMonth ? (
        monthCard(`Last month — ${lastMonth.label}`, lastTasks, setLastTasks, { canMoveDown: false })
      ) : (
        <div className="card">
          <p className="bars-empty">
            No earlier month yet — once a second report month exists, it appears here so tasks can be
            moved down.
          </p>
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 4 }}>
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save both months"}
        </button>
        {message && (
          <span className={`action-msg ${message.ok ? "success" : "error"}`} style={{ margin: 0 }}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
