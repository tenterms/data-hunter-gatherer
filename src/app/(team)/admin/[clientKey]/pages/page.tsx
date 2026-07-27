import { notFound } from "next/navigation";
import { getPagesEditorData } from "@/lib/pagesEditor";
import PagesEditor from "@/components/admin/PagesEditor";

export const dynamic = "force-dynamic";

export default async function PagesEditorPage({
  params,
}: {
  params: Promise<{ clientKey: string }>;
}) {
  const { clientKey } = await params;
  const data = await getPagesEditorData(clientKey);
  if (!data) notFound();

  return (
    <>
      <p className="subtitle">
        The pages you actively work on. Their role decides where they appear in the report&apos;s traffic
        tables, and primary/high-priority pages weight the cannibalisation checker.
      </p>
      {data.previewPeriodLabel && (
        <p className="section-desc">Real pages below come from {data.previewPeriodLabel}.</p>
      )}
      <div className="card">
        <PagesEditor
          clientKey={clientKey}
          configured={data.configured.map((p) => ({
            url: p.url,
            label: p.label,
            page_role: p.page_role,
            content_type: p.content_type,
            commercial_priority: p.commercial_priority,
            active: p.active,
            notes: p.notes,
          }))}
          discovered={data.discovered}
        />
      </div>
    </>
  );
}
