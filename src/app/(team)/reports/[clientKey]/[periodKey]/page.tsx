import Link from "next/link";
import { notFound } from "next/navigation";
import { readSnapshot } from "@/lib/snapshots";
import ReportView from "@/components/ReportView";
import PublishControls from "@/components/PublishControls";
import FocusNotesPanel from "@/components/FocusNotesPanel";
import RegenerateButton from "@/components/RegenerateButton";

export const dynamic = "force-dynamic";

export default async function TeamReportPage({
  params,
}: {
  params: Promise<{ clientKey: string; periodKey: string }>;
}) {
  const { clientKey, periodKey } = await params;
  const snapshot = readSnapshot(clientKey, periodKey);
  if (!snapshot) notFound();

  return (
    <>
      <p style={{ margin: "0 0 4px" }}>
        <Link href="/">← All reports</Link> · <Link href="/admin">Admin</Link> ·{" "}
        <Link href={`/admin/${clientKey}`}>{snapshot.client.client_name} admin</Link>
      </p>
      <h1>
        {snapshot.client.client_name} — {snapshot.period.label}
      </h1>
      <p className="subtitle">
        {snapshot.period.start_date} to {snapshot.period.end_date} (compared with{" "}
        {snapshot.period.comparison_start_date} to {snapshot.period.comparison_end_date}){" "}
        <span className={`badge ${snapshot.dataSource}`}>{snapshot.dataSource} data</span>{" "}
        <span className="badge">generated {new Date(snapshot.generatedAt).toLocaleString("en-GB")}</span>
      </p>
      <p style={{ margin: "0 0 8px" }}>
        <RegenerateButton clientKey={clientKey} periodKey={periodKey} />
      </p>
      <PublishControls clientKey={clientKey} periodKey={periodKey} published={snapshot.published ?? null} />
      <FocusNotesPanel clientKey={clientKey} periodKey={periodKey} initialNotes={snapshot.focusNotes ?? ""} />
      <ReportView snapshot={snapshot} mode="team" />
    </>
  );
}
