"use client";

import { useEffect, useState } from "react";

/**
 * Set up a client's SE Ranking project from inside the tool: add search
 * engines (engine + location), create keyword groups, and add keywords into
 * groups. Everything is pushed straight to SE Ranking; reports pick the new
 * engines/groups/keywords up automatically on the next generation.
 */

interface Status {
  ok: boolean;
  message: string;
  siteLabel?: string;
  engines?: Array<{ siteEngineId: string; label: string }>;
  groups?: Array<{ id: string; name: string }>;
  keywordCount?: number;
  systemEngines?: Array<{ id: string; name: string }>;
  systemEnginesError?: string;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/seranking-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Status & { ok: boolean; message: string };
}

export default function SeRankingSetupPanel({ clientKey }: { clientKey: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [engineQuery, setEngineQuery] = useState("");
  const [chosenEngine, setChosenEngine] = useState<{ id: string; name: string } | null>(null);
  const [regionName, setRegionName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [keywordGroupId, setKeywordGroupId] = useState("");
  const [targetUrl, setTargetUrl] = useState("");

  const refresh = async () => {
    setBusy("status");
    const result = await post({ action: "status", clientKey });
    setStatus(result);
    if (!result.ok) setMessage(result.message);
    setBusy(null);
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientKey]);

  const run = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setMessage("");
    const result = await post(body);
    setMessage(result.message);
    setBusy(null);
    if (result.ok) await refresh();
  };

  const allEngines = status?.systemEngines ?? [];
  const query = engineQuery.trim().toLowerCase();
  const engineMatches =
    query.length > 0 && (!chosenEngine || chosenEngine.name.toLowerCase() !== query)
      ? allEngines.filter((e) => e.name.toLowerCase().includes(query)).slice(0, 12)
      : [];

  return (
    <div className="card">
      <h2>SE Ranking setup</h2>
      <p className="section-desc">
        Adds search engines, keyword groups and keywords directly to this client&apos;s SE Ranking
        project. Reports pick everything up automatically on the next generation.
      </p>

      {!status && <p className="meta">Loading current SE Ranking setup…</p>}
      {status && !status.ok && <p className="meta" style={{ color: "var(--electric-orange, #b45309)" }}>{status.message}</p>}

      {status?.ok && (
        <>
          <p className="meta">
            {status.siteLabel} · {status.engines?.length ?? 0} search engine(s) ·{" "}
            {status.groups?.length ?? 0} group(s) · {status.keywordCount ?? 0} keyword(s)
          </p>
          {(status.engines?.length ?? 0) > 0 && (
            <p className="meta">Engines: {status.engines!.map((e) => e.label).join(" · ")}</p>
          )}

          <div className="nested-box">
            <h3 style={{ marginTop: 0 }}>Add a search engine</h3>
            {status.systemEnginesError ? (
              <p className="meta" style={{ color: "var(--electric-orange, #b45309)" }}>
                Couldn&apos;t load SE Ranking&apos;s engine list: {status.systemEnginesError}
              </p>
            ) : (
              <p className="meta">
                {allEngines.length.toLocaleString("en-GB")} engines available — type to search (e.g.
                &ldquo;google united&rdquo; or &ldquo;bing&rdquo;), then pick one.
              </p>
            )}
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                placeholder="Search engine (e.g. Google United States)"
                value={engineQuery}
                onChange={(e) => {
                  setEngineQuery(e.target.value);
                  setChosenEngine(null);
                }}
                style={{ minWidth: 280 }}
              />
              <input
                placeholder="Location (optional, e.g. New York)"
                value={regionName}
                onChange={(e) => setRegionName(e.target.value)}
                style={{ minWidth: 200 }}
              />
              <button
                className="btn"
                disabled={busy !== null || !chosenEngine}
                onClick={() =>
                  run(
                    { action: "add_engine", clientKey, searchEngineId: chosenEngine!.id, regionName },
                    "engine",
                  )
                }
              >
                {busy === "engine" ? "Adding…" : chosenEngine ? `Add ${chosenEngine.name}` : "Add engine"}
              </button>
            </p>
            {engineMatches.length > 0 && (
              <ul className="engine-suggestions">
                {engineMatches.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChosenEngine(e);
                        setEngineQuery(e.name);
                      }}
                    >
                      {e.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.length > 0 && engineMatches.length === 0 && !chosenEngine && !status.systemEnginesError && (
              <p className="meta">No engine matches &ldquo;{engineQuery}&rdquo; — try fewer words.</p>
            )}
          </div>

          <div className="nested-box">
            <h3 style={{ marginTop: 0 }}>Add a keyword group</h3>
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                placeholder="Group name (e.g. Penetration Testing)"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                style={{ minWidth: 260 }}
              />
              <button
                className="btn"
                disabled={busy !== null || !groupName.trim()}
                onClick={() => run({ action: "add_group", clientKey, name: groupName }, "group").then(() => setGroupName(""))}
              >
                {busy === "group" ? "Creating…" : "Create group"}
              </button>
            </p>
          </div>

          <div className="nested-box">
            <h3 style={{ marginTop: 0 }}>Add keywords</h3>
            <textarea
              placeholder={"One keyword per line, e.g.\npenetration testing sheffield\npen testing services"}
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              rows={5}
              style={{ width: "100%", marginBottom: 8 }}
            />
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={keywordGroupId} onChange={(e) => setKeywordGroupId(e.target.value)}>
                <option value="">No group</option>
                {(status.groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Target URL (optional)"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                style={{ minWidth: 220 }}
              />
              <button
                className="btn"
                disabled={busy !== null || !keywordsText.trim()}
                onClick={() =>
                  run(
                    {
                      action: "add_keywords",
                      clientKey,
                      keywords: keywordsText.split("\n"),
                      groupId: keywordGroupId || undefined,
                      targetUrl: targetUrl || undefined,
                    },
                    "keywords",
                  ).then(() => setKeywordsText(""))
                }
              >
                {busy === "keywords" ? "Adding…" : "Add keywords"}
              </button>
            </p>
          </div>
        </>
      )}

      {message && <p className="meta">{message}</p>}
    </div>
  );
}
