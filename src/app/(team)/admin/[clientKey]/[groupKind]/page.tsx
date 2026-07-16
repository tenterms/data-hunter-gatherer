import Link from "next/link";
import { notFound } from "next/navigation";
import { getEditorData } from "@/lib/groupEditor";
import GroupEditor from "@/components/admin/GroupEditor";

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
      <p style={{ margin: "0 0 4px" }}>
        <Link href="/admin">← Admin</Link>
      </p>
      <h1>
        {data.client.client_name}: {title}
      </h1>
      <p className="subtitle">{explainer}</p>
      {data.previewPeriodLabel && (
        <p className="section-desc">Match previews use {data.previewPeriodLabel}.</p>
      )}
      <div className="card">
        <GroupEditor clientKey={clientKey} kind={kind} items={data.items} />
      </div>
      <p className="section-desc">
        Also see:{" "}
        <Link href={`/admin/${clientKey}/${kind === "topic" ? "content-groups" : "topic-clusters"}`}>
          {kind === "topic" ? "Content groups" : "Topic clusters"}
        </Link>
      </p>
    </>
  );
}
