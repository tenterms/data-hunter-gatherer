import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAdminConfig } from "@/lib/sheets";
import { readReactimusSnapshot } from "@/lib/reactimus";
import ReactimusPanel from "@/components/reactimus/ReactimusPanel";

export const dynamic = "force-dynamic";

export default async function ReactimusClientPage({
  params,
}: {
  params: Promise<{ clientKey: string }>;
}) {
  const { clientKey } = await params;
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) notFound();

  const snapshot = readReactimusSnapshot(clientKey);
  const keyPageCount = config.clientPages.filter(
    (p) => p.client_key === clientKey && p.active,
  ).length;

  return (
    <>
      <p style={{ margin: "0 0 4px" }}>
        <Link href="/reactimus">← All clients</Link> ·{" "}
        <Link href={`/admin/${clientKey}`}>Admin</Link>
      </p>
      <h1>Reactimus — {client.client_name}</h1>
      <p className="subtitle">
        Suggestions built from the last three months of Search Console data for the client&apos;s{" "}
        {keyPageCount} key page{keyPageCount === 1 ? "" : "s"}. &ldquo;Add to report&rdquo; puts a
        suggestion into the strategic priorities of the client&apos;s latest month.
      </p>
      <ReactimusPanel clientKey={clientKey} snapshot={snapshot} />
    </>
  );
}
