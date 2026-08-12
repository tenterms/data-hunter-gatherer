"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Pull content groups / topic clusters for a client from SEO Gets and import
 * them. Whichever kind SEO Gets doesn't provide is derived 1:1 (a "Sheffield"
 * content group implies a "Sheffield" topic cluster), with warnings for
 * anything that doesn't translate cleanly. The proposal is editable JSON, so
 * anomalies can be fixed before importing.
 */

interface ImportItem {
  name: string;
  contains: string[];
  notContains: string[];
  description?: string;
}

interface PullResponse {
  ok: boolean;
  message: string;
  proposal?: { contentGroups: ImportItem[]; topicClusters: ImportItem[] };
  warnings: string[];
  debug: { tools: string[]; calls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> };
}

export default function SeoGetsImportPanel({
  clientKey,
  connected,
}: {
  clientKey: string;
  connected: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"pull" | "import" | null>(null);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [proposalText, setProposalText] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [debug, setDebug] = useState<PullResponse["debug"] | null>(null);

  const pull = async () => {
    setBusy("pull");
    setMessage("Pulling from SEO Gets…");
    setResults([]);
    const res = await fetch("/api/seogets/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey }),
    });
    const data = (await res.json()) as PullResponse;
    setMessage(data.message);
    setWarnings(data.warnings ?? []);
    setDebug(data.debug ?? null);
    if (data.proposal) setProposalText(JSON.stringify(data.proposal, null, 2));
    setBusy(null);
  };

  const doImport = async () => {
    let parsed: { contentGroups?: ImportItem[]; topicClusters?: ImportItem[] };
    try {
      parsed = JSON.parse(proposalText);
    } catch {
      setMessage("That JSON doesn't parse — fix it and try again.");
      return;
    }
    setBusy("import");
    const res = await fetch("/api/admin/import-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey, ...parsed }),
    });
    const data = (await res.json()) as { ok: boolean; message: string; results?: string[] };
    setMessage(data.message);
    setResults(data.results ?? []);
    setBusy(null);
    router.refresh();
  };

  return (
    <div className="card">
      <h2>Import from SEO Gets</h2>
      {!connected ? (
        <p>
          <a className="btn" href="/api/seogets/connect">
            Connect SEO Gets
          </a>{" "}
          <span className="meta">
            One-time login with your SEO Gets account; after that any client can be pulled.
          </span>
        </p>
      ) : (
        <>
          <p style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" onClick={pull} disabled={busy !== null}>
              {busy === "pull" ? "Pulling…" : "Pull groups from SEO Gets"}
            </button>
            {proposalText && (
              <button className="btn" onClick={doImport} disabled={busy !== null}>
                {busy === "import" ? "Importing…" : "Import into this client"}
              </button>
            )}
            <span className="meta">Connected to SEO Gets</span>
          </p>
          {message && <p className="meta">{message}</p>}
          {warnings.length > 0 && (
            <ul className="meta" style={{ color: "var(--electric-orange, #b45309)" }}>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {proposalText && (
            <>
              <p className="section-desc">
                Review before importing: whichever side SEO Gets didn&apos;t define was derived 1:1
                from the other. Edit the JSON directly to fix any anomaly.
              </p>
              <textarea
                value={proposalText}
                onChange={(e) => setProposalText(e.target.value)}
                rows={16}
                style={{ width: "100%", fontFamily: "monospace", fontSize: 12.5 }}
              />
            </>
          )}
          {results.length > 0 && (
            <pre className="test-output" style={{ maxHeight: 160, overflow: "auto" }}>
              {results.join("\n")}
            </pre>
          )}
          {debug && (
            <details>
              <summary className="meta">What the SEO Gets MCP returned (debug)</summary>
              <pre className="test-output" style={{ maxHeight: 280, overflow: "auto" }}>
                {JSON.stringify(debug, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
