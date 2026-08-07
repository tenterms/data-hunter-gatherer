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
  const roleOrder: Record<string, number> = { primary: 0, secondary: 1, supporting: 2, rest_of_site: 3 };
  const keyPages = config.clientPages
    .filter((p) => p.client_key === clientKey && p.active)
    .sort((a, b) => (roleOrder[a.page_role] ?? 9) - (roleOrder[b.page_role] ?? 9))
    .map((p) => ({ url: p.url, label: p.label, role: p.page_role }));

  return (
    <>
      <p style={{ margin: "0 0 4px" }}>
        <Link href="/reactimus">← All clients</Link> ·{" "}
        <Link href={`/admin/${clientKey}`}>Admin</Link>
      </p>
      <h1>Reactimus — {client.client_name}</h1>
      <p className="subtitle">
        Pick the pages to analyse (2–5 works best), run the analysis, and the suggestions appear
        under each page. &ldquo;Add to report&rdquo; puts a suggestion into the strategic priorities
        of the client&apos;s latest month; &ldquo;archive&rdquo; rules it out for good.
      </p>
      <ReactimusPanel clientKey={clientKey} snapshot={snapshot} keyPages={keyPages} />
    </>
  );
}
