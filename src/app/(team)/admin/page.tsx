import { getAdminOverview } from "@/lib/adminActions";
import NewClientForm from "@/components/admin/NewClientForm";
import ClientAdminCard from "@/components/admin/ClientAdminCard";
import SetupSheetButton from "@/components/admin/SetupSheetButton";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const overview = await getAdminOverview();

  return (
    <>
      <h1>Admin</h1>
      <p className="subtitle">
        Run everything from here: create clients, add reporting months, import rankings, and generate
        reports. Detailed configuration (key pages, content groups, topic clusters, DRAW tasks, commentary
        overrides) lives in the Google Sheet.
      </p>

      <div className="card">
        <h2>Connection status</h2>
        <ul className="status-list">
          <li>
            <span className={`badge ${overview.configSource === "sheets" ? "live" : "mock"}`}>
              {overview.configSource === "sheets" ? "Google Sheet connected" : "Mock mode"}
            </span>{" "}
            {overview.configSource === "sheets" ? (
              <>
                Config is read from{" "}
                <a href={overview.sheetUrl!} target="_blank" rel="noreferrer">
                  the admin sheet
                </a>
                .
              </>
            ) : (
              <>
                No Google credentials yet, so everything works against local demo config and simulated GSC
                data. Once the one-time credential setup is done (see the README), this switches to live
                automatically.
              </>
            )}
          </li>
          <li>
            <span className={`badge ${overview.hasGoogleCredentials ? "live" : "mock"}`}>
              {overview.hasGoogleCredentials ? "Search Console: live" : "Search Console: simulated"}
            </span>
          </li>
          <li>
            <span className={`badge ${overview.llmEnabled ? "live" : ""}`}>
              {overview.llmEnabled ? "AI commentary: on" : "AI commentary: off (rules-based text is used)"}
            </span>
          </li>
        </ul>
        <SetupSheetButton />
      </div>

      <div className="card">
        <h2>Add a new client</h2>
        <NewClientForm />
      </div>

      {overview.clients.length === 0 ? (
        <div className="card">
          <p className="bars-empty">No clients yet — add the first one above.</p>
        </div>
      ) : (
        overview.clients.map((c) => (
          <ClientAdminCard key={c.client.client_key} overview={c} sheetUrl={overview.sheetUrl} />
        ))
      )}
    </>
  );
}
