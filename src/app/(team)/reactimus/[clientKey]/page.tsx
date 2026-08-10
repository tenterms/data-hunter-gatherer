import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAdminConfig } from "@/lib/sheets";
import { readReactimusSnapshot, reactimusPages } from "@/lib/reactimus";
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
  const pages = await reactimusPages(clientKey);
  const hasMasterList = config.masterPages.some((p) => p.client_key === clientKey && p.active);

  return (
    <>
      <p style={{ margin: "0 0 4px" }}>
        <Link href="/reactimus">← All clients</Link> ·{" "}
        <Link href={`/reactimus/${clientKey}/pages`}>Master page list</Link> ·{" "}
        <Link href={`/admin/${clientKey}`}>Admin</Link>
      </p>
      <h1>Reactimus — {client.client_name}</h1>
      <p className="subtitle">
        Pick the pages to analyse (2–5 works best), run the analysis, and each page gets one row
        per keyword with the exact before/after edit. Statuses track review; &ldquo;Add to
        report&rdquo; puts a row into the latest month&apos;s strategic priorities; archive rules
        it out for good.
      </p>
      {!hasMasterList && (
        <p className="subtitle" style={{ color: "var(--electric-orange, #ff8c55)" }}>
          No master page list yet — build it first on the{" "}
          <Link href={`/reactimus/${clientKey}/pages`}>Master page list</Link> page so suggestions
          are aware of the whole site.
        </p>
      )}
      <ReactimusPanel clientKey={clientKey} snapshot={snapshot} keyPages={pages} />
    </>
  );
}
