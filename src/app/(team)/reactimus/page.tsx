import Link from "next/link";
import { loadAdminConfig } from "@/lib/sheets";
import { readReactimusSnapshot } from "@/lib/reactimus";

export const dynamic = "force-dynamic";

/** Reactimus home: pick a client. Every client is available automatically. */
export default async function ReactimusPage() {
  const { config } = await loadAdminConfig();
  const clients = config.clients.filter((c) => c.active);

  return (
    <>
      <h1>Reactimus</h1>
      <p className="subtitle">
        Page improvement suggestions and new page ideas, built from each client&apos;s live Google
        Search Console data. Pick a client — anything useful can be added straight to their report.
      </p>
      <div className="card">
        <ul className="report-list client-menu">
          {clients.map((client) => {
            const snapshot = readReactimusSnapshot(client.client_key);
            return (
              <li key={client.client_key}>
                <span>
                  <Link href={`/reactimus/${client.client_key}`} className="client-link">
                    {client.client_name}
                  </Link>{" "}
                  <span className="meta">{client.domain}</span>
                </span>
                <span className="meta">
                  {snapshot
                    ? `${snapshot.suggestedEdits.length} improvements · ${snapshot.newPageIdeas.length} new page ideas · run ${new Date(snapshot.generatedAt).toLocaleDateString("en-GB")}`
                    : "not analysed yet"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
