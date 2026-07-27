import Link from "next/link";
import { notFound } from "next/navigation";
import { getDrawEditorData } from "@/lib/drawEditor";
import DrawEditor from "@/components/admin/DrawEditor";

export const dynamic = "force-dynamic";

export default async function DrawEditorPage({
  params,
}: {
  params: Promise<{ clientKey: string; periodKey: string }>;
}) {
  const { clientKey, periodKey } = await params;
  const data = await getDrawEditorData(clientKey, periodKey);
  if (!data) notFound();

  return (
    <>
      <h2 style={{ margin: "12px 0 4px" }}>Work grid — {data.period.label}</h2>
      <p className="subtitle">
        <Link href={`/admin/${clientKey}`}>← Back to months</Link> ·{" "}
        What was completed this month and what&apos;s planned next month, shown in the report&apos;s
        &ldquo;Work completed &amp; planned&rdquo; section.
      </p>
      <div className="card">
        <DrawEditor
          clientKey={clientKey}
          periodKey={periodKey}
          initialTasks={data.tasks.map((t) => ({
            timing: t.timing,
            category: t.category,
            title: t.title,
            description: t.description,
          }))}
        />
      </div>
    </>
  );
}
