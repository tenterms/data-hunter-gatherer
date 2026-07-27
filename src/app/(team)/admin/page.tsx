import Link from "next/link";
import { getAdminOverview } from "@/lib/adminActions";
import NewClientForm from "@/components/admin/NewClientForm";
import SetupSheetButton from "@/components/admin/SetupSheetButton";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const overview = await getAdminOverview();

  return (
    <>
      <h1>Clients</h1>
      <p className="subtitle">Pick a client to manage their reports, pages, groups and clusters.</p>

      <div className="card">
        {overview.clients.length === 0 ? (
          <p className="bars-empty">No clients yet — add the first one below.</p>
        ) : (
          <ul className="report-list client-menu">
            {overview.clients.map(({ client, periods, counts }) => (
              <li key={client.client_key}>
                <div>
                  <Link href={`/admin/${client.client_key}`} className="client-link">
                    {client.client_name}
                  </Link>
                  <div className="meta">
                    {client.domain} · {periods.length} report month{periods.length === 1 ? "" : "s"} ·{" "}
                    {counts.pages} key pages · {counts.contentGroups} content groups ·{" "}
                    {counts.topicClusters} topic clusters
                  </div>
                </div>
                <Link className="btn" href={`/admin/${client.client_key}`}>
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Add a new client</h2>
        <NewClientForm />
      </div>

      <div className="card">
        <h2>Connection status</h2>
        <ul className="status-list">
          <li>
            <span className="badge live">
              {overview.configSource === "sheets" ? "Storage: Google Sheet" : "Storage: built-in database"}
            </span>{" "}
            {overview.configSource === "sheets" && overview.sheetUrl && (
              <a href={overview.sheetUrl} target="_blank" rel="noreferrer">
                open the admin sheet
              </a>
            )}
          </li>
          <li>
            <span className={`badge ${overview.hasGoogleCredentials ? "live" : "mock"}`}>
              {overview.hasGoogleCredentials ? "Search Console: live" : "Search Console: simulated"}
            </span>{" "}
            {!overview.hasGoogleCredentials &&
              "No Google credentials yet, so report data is demo data. Add the service-account key (see README) to go live."}
          </li>
          <li>
            <span className={`badge ${overview.llmEnabled ? "live" : ""}`}>
              {overview.llmEnabled ? "AI commentary: on" : "AI commentary: off (rules-based text is used)"}
            </span>
          </li>
        </ul>
        {overview.configSource === "sheets" && <SetupSheetButton />}
      </div>
    </>
  );
}
