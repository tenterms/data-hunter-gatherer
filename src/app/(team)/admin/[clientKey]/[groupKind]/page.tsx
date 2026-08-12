import { notFound } from "next/navigation";
import { getEditorData } from "@/lib/groupEditor";
import { seoGetsConnected } from "@/lib/seogets";
import GroupEditor from "@/components/admin/GroupEditor";
import SeoGetsImportPanel from "@/components/admin/SeoGetsImportPanel";

export const dynamic = "force-dynamic";

export default async function GroupEditorPage({
  params,
}: {
  params: Promise<{ clientKey: string; groupKind: string }>;
}) {
  const { clientKey, groupKind } = await params;
  const kind = groupKind === "topic-clusters" ? "topic" : groupKind === "content-groups" ? "content" : null;
  if (!kind) notFound();
  const data = await getEditorData(clientKey, kind);
  if (!data) notFound();

  const title = kind === "topic" ? "Topic clusters" : "Content groups";
  const explainer =
    kind === "topic"
      ? "A topic cluster is a collection of related search queries. Add “contains” terms (any can match) and optional exclusions — the list below shows exactly which real queries match as you type."
      : "A content group is a collection of pages. Add URL fragments the page address should contain (any can match) and optional exclusions — the list below shows exactly which real pages match as you type.";

  return (
    <>
      <h2 style={{ margin: "12px 0 4px" }}>{title}</h2>
      <p className="subtitle">{explainer}</p>
      {data.previewPeriodLabel && (
        <p className="section-desc">Match previews use {data.previewPeriodLabel}.</p>
      )}
      <div className="card">
        <GroupEditor clientKey={clientKey} kind={kind} items={data.items} />
      </div>
      <SeoGetsImportPanel clientKey={clientKey} connected={seoGetsConnected()} />
    </>
  );
}
