import { notFound } from "next/navigation";
import { getReportSettingsData } from "@/lib/reportSettings";
import ReportSettingsPanel from "@/components/admin/ReportSettingsPanel";
import SeRankingSetupPanel from "@/components/admin/SeRankingSetupPanel";
import GoogleGscPanel from "@/components/admin/GoogleGscPanel";

export const dynamic = "force-dynamic";

export default async function ReportSettingsPage({
  params,
}: {
  params: Promise<{ clientKey: string }>;
}) {
  const { clientKey } = await params;
  const data = await getReportSettingsData(clientKey);
  if (!data) notFound();

  return (
    <>
      <h2 style={{ margin: "12px 0 4px" }}>Report settings</h2>
      <p className="subtitle">
        Control how the report displays: search engine order for the rankings slider, and which
        cannibalisation rows the client sees.
        {data.latestPeriodLabel
          ? ` Based on the latest generated report (${data.latestPeriodLabel}).`
          : " Generate a report first to see the options here."}
      </p>
      <ReportSettingsPanel
        clientKey={clientKey}
        initialEngines={data.engines}
        initialCannibalisation={data.cannibalisation}
      />
      <GoogleGscPanel clientKey={clientKey} />
      <SeRankingSetupPanel clientKey={clientKey} />
    </>
  );
}
