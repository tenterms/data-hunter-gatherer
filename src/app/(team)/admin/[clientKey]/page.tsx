import { notFound } from "next/navigation";
import { getAdminOverview } from "@/lib/adminActions";
import { hasTargetingProposal } from "@/lib/applyTargeting";
import ClientOverviewPanel from "@/components/admin/ClientOverviewPanel";
import ApplyTargetingPanel from "@/components/admin/ApplyTargetingPanel";

export const dynamic = "force-dynamic";

export default async function ClientAdminPage({
  params,
}: {
  params: Promise<{ clientKey: string }>;
}) {
  const { clientKey } = await params;
  const overview = await getAdminOverview();
  const client = overview.clients.find((c) => c.client.client_key === clientKey);
  if (!client) notFound();
  const proposal = await hasTargetingProposal(clientKey);

  return (
    <>
      <ClientOverviewPanel overview={client} />
      {proposal && <ApplyTargetingPanel clientKey={clientKey} />}
    </>
  );
}
