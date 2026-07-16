import Link from "next/link";
import { listSnapshots } from "@/lib/snapshots";
import { loadAdminConfig } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshots = listSnapshots();

  let clientNames: Array<{ key: string; name: string }> = [];
  try {
    const { config } = await loadAdminConfig();
    clientNames = config.clients.filter((c) => c.active).map((c) => ({ key: c.client_key, name: c.client_name }));
  } catch {
    // config unavailable — still show any generated snapshots
  }
  const clientsWithReports = new Set(snapshots.map((s) => s.clientKey));

  return (
    <>
      <h1>Monthly SEO reports</h1>
      <p className="subtitle">
        Generated report snapshots. Add clients, build report elements and generate reports from the{" "}
        <Link href="/admin">Admin page</Link>.
      </p>

      <div className="card">
        <h2>Generated reports</h2>
        {snapshots.length === 0 ? (
          <p className="section-desc">
            No reports yet — head to the <Link href="/admin">Admin page</Link> to generate one.
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
          <h2>Clients without reports yet</h2>
          <ul className="report-list">
            {clientNames
              .filter((c) => !clientsWithReports.has(c.key))
              .map((c) => (
                <li key={c.key}>
                  <div>
                    <strong>{c.name}</strong>
                    <div className="meta">
                      Generate their first report from the <Link href="/admin">Admin page</Link>.
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
