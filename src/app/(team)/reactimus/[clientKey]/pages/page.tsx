import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAdminConfig } from "@/lib/sheets";
import MasterPagesPanel from "@/components/reactimus/MasterPagesPanel";

export const dynamic = "force-dynamic";

export default async function MasterPagesPage({
  params,
}: {
  params: Promise<{ clientKey: string }>;
}) {
  const { clientKey } = await params;
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) notFound();

  const rows = config.masterPages.filter((p) => p.client_key === clientKey);

  return (
    <>
      <p style={{ margin: "0 0 4px" }}>
        <Link href={`/reactimus/${clientKey}`}>← Reactimus</Link> ·{" "}
        <Link href={`/admin/${clientKey}`}>Admin</Link>
      </p>
      <h1>Master page list — {client.client_name}</h1>
      <p className="subtitle">
        Every page on the site with the primary keyword it targets, shared between the reports and
        Reactimus. The keywords are Claude&apos;s best guess from each page&apos;s title and H1 —
        correct the wrong ones. Use <strong>Section</strong> and <strong>Close group</strong> to
        organise the list: changing them moves the page into that group, and pages in the same
        close group are treated as natural internal-link partners.
      </p>
      <MasterPagesPanel clientKey={clientKey} initialRows={rows} domain={client.domain} />
    </>
  );
}
