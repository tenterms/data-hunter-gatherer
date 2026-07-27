import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAdminConfig } from "@/lib/sheets";
import ClientTabs from "@/components/admin/ClientTabs";

/** Wraps every page in a client's admin area with its header and tab nav. */
export default async function ClientAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientKey: string }>;
}) {
  const { clientKey } = await params;
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) notFound();

  return (
    <>
      <p style={{ margin: "0 0 4px" }}>
        <Link href="/admin">← All clients</Link>
      </p>
      <div className="bars-header" style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>{client.client_name}</h1>
        <span className="badge">{client.domain}</span>
      </div>
      <ClientTabs clientKey={clientKey} />
      {children}
    </>
  );
}
