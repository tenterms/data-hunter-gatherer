import Link from "next/link";
import { listSnapshots } from "@/lib/snapshots";
import { loadAdminConfigFromMock } from "@/lib/sheets";
import { getAppConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshots = listSnapshots();
  const app = getAppConfig();

  // Show configured clients even before any report has been generated.
  let clientNames: Array<{ key: string; name: string }> = [];
  try {
    if (!app.hasSheets) {
      const mock = loadAdminConfigFromMock();
      clientNames = mock.clients.filter((c) => c.active).map((c) => ({ key: c.client_key, name: c.client_name }));
    }
  } catch {
    // no mock file — fine
  }
  const clientsWithReports = new Set(snapshots.map((s) => s.clientKey));

  return (
    <>
      <h1>Monthly SEO reports</h1>
      <p className="subtitle">
        Generated report snapshots. Configure clients in Google Sheets, then run{" "}
        <code>npm run generate-report -- --client=… --period=…</code>.
      </p>

      {!app.hasSheets && (
        <div className="notice">
          Running in <strong>mock mode</strong> — Google credentials are not configured, so config comes from{" "}
          <code>data/mock/sheet.json</code> and GSC data is simulated. See the README for going live.
        </div>
      )}

      <div className="card">
        <h2>Generated reports</h2>
        {snapshots.length === 0 ? (
          <p className="section-desc">
            No reports yet. Run <code>npm run generate-all-reports</code> to build the demo reports.
          </p>
        ) : (
          <ul className="report-list">
            {snapshots.map((s) => (
              <li key={`${s.clientKey}-${s.periodKey}`}>
                <div>
                  <Link href={`/reports/${s.clientKey}/${s.periodKey}`}>
                    <strong>{s.clientName}</strong> — {s.periodLabel}
                  </Link>
                  <div className="meta">
                    {s.totalClicks.toLocaleString("en-GB")} clicks · generated{" "}
                    {new Date(s.generatedAt).toLocaleString("en-GB")}
                  </div>
                </div>
                <span className={`badge ${s.dataSource}`}>{s.dataSource} data</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {clientNames.filter((c) => !clientsWithReports.has(c.key)).length > 0 && (
        <div className="card">
          <h2>Configured clients without reports</h2>
          <ul className="report-list">
            {clientNames
              .filter((c) => !clientsWithReports.has(c.key))
              .map((c) => (
                <li key={c.key}>
                  <div>
                    <strong>{c.name}</strong>
                    <div className="meta">
                      Run <code>npm run generate-report -- --client={c.key} --period=PERIOD_KEY</code>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}
    </>
  );
}
