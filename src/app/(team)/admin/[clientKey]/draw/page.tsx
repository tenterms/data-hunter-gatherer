import { notFound } from "next/navigation";
import { loadAdminConfig } from "@/lib/sheets";
import DrawMonthsEditor from "@/components/admin/DrawMonthsEditor";

export const dynamic = "force-dynamic";

/**
 * Client-level work grid editor: this month and last month side by side, with
 * a one-click "move to last month" on this month's tasks for the monthly
 * roll-over. Per-period editors still exist at /draw/[periodKey].
 */
export default async function DrawMonthsPage({
  params,
}: {
  params: Promise<{ clientKey: string }>;
}) {
  const { clientKey } = await params;
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) notFound();

  const periods = config.reportPeriods
    .filter((p) => p.client_key === clientKey)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const thisMonth = periods[0] ?? null;
  const lastMonth = periods[1] ?? null;

  const tasksFor = (periodKey: string) =>
    config.drawTasks
      .filter((t) => t.client_key === clientKey && t.period_key === periodKey)
      .map((t) => ({ timing: t.timing, category: t.category, title: t.title, description: t.description }));

  return (
    <>
      <h2 style={{ margin: "12px 0 4px" }}>Work grid</h2>
      <p className="subtitle">
        What was completed and what&apos;s planned, shown in each report&apos;s &ldquo;Work completed
        &amp; planned&rdquo; section. When a new month starts, use &ldquo;→ last month&rdquo; to move
        finished tasks down.
      </p>
      {!thisMonth ? (
        <div className="card">
          <p className="bars-empty">No report months yet — add one from the Overview tab first.</p>
        </div>
      ) : (
        <DrawMonthsEditor
          clientKey={clientKey}
          thisMonth={{ periodKey: thisMonth.period_key, label: thisMonth.label, tasks: tasksFor(thisMonth.period_key) }}
          lastMonth={
            lastMonth
              ? { periodKey: lastMonth.period_key, label: lastMonth.label, tasks: tasksFor(lastMonth.period_key) }
              : null
          }
        />
      )}
    </>
  );
}
