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

const CATEGORY_LABELS: Record<DrawCategory, string> = {
  design_dev: "Design & Development",
  reactive_seo: "Reactive SEO",
  anything_else: "Anything Else",
  writing: "Writing & Content",
};

const TIMING_LABELS: Record<DrawTiming, string> = {
  completed_this_month: "Completed this month",
  planned_next_month: "Planned next month",
};

/** Editor for the month's DRAW work grid. */
export default function DrawEditor({
  clientKey,
  periodKey,
  initialTasks,
}: {
  clientKey: string;
  periodKey: string;
  initialTasks: Task[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function update(index: number, patch: Partial<Task>) {
    setTasks(tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function add(timing: DrawTiming) {
    setTasks([...tasks, { timing, category: "reactive_seo", title: "", description: "" }]);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, periodKey, tasks }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage({ ok: data.ok, text: data.message });
      if (data.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const section = (timing: DrawTiming) => (
    <div key={timing}>
      <h3>{TIMING_LABELS[timing]}</h3>
      {tasks.map((task, i) =>
        task.timing === timing ? (
          <div className="draw-edit-row" key={i}>
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
            <button className="row-toggle" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>
              remove
            </button>
          </div>
        ) : null,
      )}
      <button className="btn" style={{ marginTop: 4 }} onClick={() => add(timing)}>
        + Add task
      </button>
    </div>
  );

  return (
    <div>
      {section("completed_this_month")}
      <div style={{ height: 18 }} />
      {section("planned_next_month")}
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save tasks"}
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
