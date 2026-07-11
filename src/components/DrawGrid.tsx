import type { DrawCategory, DrawTaskRow, DrawTiming } from "@/lib/types";

const CATEGORY_LABELS: Record<DrawCategory, string> = {
  design_dev: "Design & Development",
  reactive_seo: "Reactive SEO",
  anything_else: "Anything Else",
  writing: "Writing & Content",
};

const CATEGORY_ORDER: DrawCategory[] = ["design_dev", "reactive_seo", "anything_else", "writing"];

function TaskColumns({ tasks }: { tasks: DrawTaskRow[] }) {
  return (
    <div className="draw-grid">
      {CATEGORY_ORDER.map((category) => {
        const items = tasks.filter((t) => t.category === category);
        return (
          <div className="draw-column" key={category}>
            <h3>{CATEGORY_LABELS[category]}</h3>
            {items.length === 0 ? (
              <p className="bars-empty">—</p>
            ) : (
              <ul>
                {items.map((t, i) => (
                  <li key={`${t.title}-${i}`}>
                    <span className="task-title">{t.title}</span>
                    {t.description && <span className="task-desc">{t.description}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The agency's monthly DRAW work grid: completed this month / planned next month. */
export default function DrawGrid({ tasks }: { tasks: DrawTaskRow[] }) {
  if (tasks.length === 0) {
    return <p className="bars-empty">No DRAW tasks recorded for this period — add them to the DrawTasks sheet tab.</p>;
  }
  const byTiming = (timing: DrawTiming) => tasks.filter((t) => t.timing === timing);
  return (
    <div>
      <h3 style={{ margin: "0 0 10px" }}>Completed this month</h3>
      <TaskColumns tasks={byTiming("completed_this_month")} />
      <h3 style={{ margin: "20px 0 10px" }}>Planned next month</h3>
      <TaskColumns tasks={byTiming("planned_next_month")} />
    </div>
  );
}
