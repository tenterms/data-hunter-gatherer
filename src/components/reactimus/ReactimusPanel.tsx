"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivedSuggestion, ReactimusSnapshot } from "@/lib/reactimus";
import type { NewPageIdeaRow, RecommendationRow, SuggestedEditRow } from "@/reactimus/types";

/** Client-side view of a Reactimus snapshot: run control + suggestion lists. */

const normUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");
const editKey = (e: SuggestedEditRow) =>
  `edit##${normUrl(e.url)}##${e.editType}##${(e.keywordsTargeted.split(";")[0] ?? "").trim().toLowerCase()}`;
const ideaKey = (i: NewPageIdeaRow) =>
  `idea##${normUrl(i.sourceUrl)}##${i.suggestedPageIdea.trim().toLowerCase()}`;
const recKey = (r: RecommendationRow) =>
  `rec##${normUrl(r.url)}##${r.canonicalQueryGroup.trim().toLowerCase()}`;

const shortPath = (url: string) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

export default function ReactimusPanel({
  clientKey,
  snapshot,
}: {
  clientKey: string;
  snapshot: ReactimusSnapshot | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [added, setAdded] = useState<Record<string, string>>(snapshot?.added ?? {});
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [archived, setArchived] = useState<Record<string, ArchivedSuggestion>>(
    snapshot?.archived ?? {},
  );
  const [archivingKey, setArchivingKey] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    setRunLog(null);
    try {
      const res = await fetch("/api/reactimus/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey }),
      });
      const data = (await res.json()) as { ok: boolean; message: string; log?: string[] };
      setMessage({ ok: data.ok, text: data.message });
      if (data.log) setRunLog(data.log);
      if (data.ok) router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Run failed." });
    } finally {
      setRunning(false);
    }
  }

  async function addToReport(key: string) {
    setAddingKey(key);
    try {
      const res = await fetch("/api/reactimus/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, key }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage({ ok: data.ok, text: data.message });
      if (data.ok) setAdded((prev) => ({ ...prev, [key]: "added" }));
    } finally {
      setAddingKey(null);
    }
  }

  async function archiveSuggestion(key: string, entry: Omit<ArchivedSuggestion, "archivedAt">) {
    setArchivingKey(key);
    try {
      const res = await fetch("/api/reactimus/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, key, action: "archive" }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage({ ok: data.ok, text: data.message });
      if (data.ok) {
        setArchived((prev) => ({ ...prev, [key]: { archivedAt: new Date().toISOString(), ...entry } }));
      }
    } finally {
      setArchivingKey(null);
    }
  }

  async function restoreSuggestion(key: string) {
    setArchivingKey(key);
    try {
      const res = await fetch("/api/reactimus/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, key, action: "restore" }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage({ ok: data.ok, text: data.message });
      if (data.ok) {
        setArchived((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    } finally {
      setArchivingKey(null);
    }
  }

  const AddButton = ({ suggestionKey }: { suggestionKey: string }) =>
    added[suggestionKey] ? (
      <span className="badge live">in report</span>
    ) : (
      <button
        className="btn"
        style={{ padding: "3px 12px", fontSize: 13 }}
        onClick={() => addToReport(suggestionKey)}
        disabled={addingKey === suggestionKey}
      >
        {addingKey === suggestionKey ? "Adding…" : "Add to report"}
      </button>
    );

  const ArchiveButton = ({
    suggestionKey,
    entry,
  }: {
    suggestionKey: string;
    entry: Omit<ArchivedSuggestion, "archivedAt">;
  }) => (
    <button
      className="row-toggle off"
      title="Rule this out — it stays suppressed on future runs"
      onClick={() => archiveSuggestion(suggestionKey, entry)}
      disabled={archivingKey === suggestionKey}
    >
      {archivingKey === suggestionKey ? "…" : "archive"}
    </button>
  );

  const liveEdits = (snapshot?.suggestedEdits ?? []).filter((e) => !archived[editKey(e)]);
  const liveIdeas = (snapshot?.newPageIdeas ?? []).filter((i) => !archived[ideaKey(i)]);
  const liveRecs = (snapshot?.recommendations ?? []).filter((r) => !archived[recKey(r)]);
  const archivedEntries = Object.entries(archived).sort(
    (a, b) => b[1].archivedAt.localeCompare(a[1].archivedAt),
  );

  return (
    <>
      <div className="card">
        <div className="btn-row">
          <button className="btn primary" onClick={run} disabled={running}>
            {running ? "Analysing… (this can take a minute)" : snapshot ? "Re-run analysis" : "Run analysis"}
          </button>
          {snapshot && (
            <span className="section-desc" style={{ margin: 0 }}>
              Last run {new Date(snapshot.generatedAt).toLocaleString("en-GB")} ·{" "}
              {snapshot.window.start} to {snapshot.window.end} · {snapshot.property}
            </span>
          )}
          {message && (
            <span className={`action-msg ${message.ok ? "success" : "error"}`} style={{ margin: 0 }}>
              {message.text}
            </span>
          )}
        </div>
        {runLog && <pre className="test-output" style={{ marginTop: 12 }}>{runLog.join("\n")}</pre>}
        {snapshot && (
          <details style={{ marginTop: 10 }}>
            <summary className="section-desc" style={{ cursor: "pointer", display: "list-item" }}>
              Pages analysed ({snapshot.pagesAnalysed.length})
            </summary>
            <ul className="status-list" style={{ marginTop: 8 }}>
              {snapshot.pagesAnalysed.map((p) => (
                <li key={p.url}>
                  <strong>{shortPath(p.url)}</strong> — {p.status}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {!snapshot ? (
        <div className="card">
          <p className="bars-empty">
            No analysis yet — hit &ldquo;Run analysis&rdquo; to pull this client&apos;s Search
            Console data and build suggestions.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Page improvements</h2>
            <p className="section-desc">
              Copy-and-paste changes to existing pages, based on searches each page already shows up
              for but doesn&apos;t fully cover.
            </p>
            {liveEdits.length === 0 ? (
              <p className="bars-empty">No page improvements suggested in the last run.</p>
            ) : (
              liveEdits.map((edit) => {
                const key = editKey(edit);
                return (
                  <div className="nested-box reactimus-item" key={key}>
                    <div className="reactimus-item-header">
                      <div>
                        <span className={`badge flag-${edit.priority}`}>{edit.priority}</span>{" "}
                        <strong>{edit.editType}</strong> on{" "}
                        <a href={edit.url} target="_blank" rel="noreferrer">
                          {shortPath(edit.url)}
                        </a>
                      </div>
                      <span className="reactimus-actions">
                        <ArchiveButton
                          suggestionKey={key}
                          entry={{
                            kind: "Page improvement",
                            title: `${edit.editType} on ${shortPath(edit.url)}`,
                            detail: edit.keywordsTargeted.split(";").slice(0, 3).join(";"),
                          }}
                        />
                        <AddButton suggestionKey={key} />
                      </span>
                    </div>
                    <p className="section-desc" style={{ margin: "6px 0" }}>
                      {edit.whereOnPage} · targets: {edit.keywordsTargeted}
                    </p>
                    <p style={{ margin: "6px 0" }}>{edit.why}</p>
                    <pre className="reactimus-copy">{edit.suggestedCopy}</pre>
                  </div>
                );
              })
            )}
          </div>

          <div className="card">
            <h2>New page ideas</h2>
            <p className="section-desc">
              Searches with real demand that none of the client&apos;s pages properly serve —
              candidates for brand-new pages.
            </p>
            {liveIdeas.length === 0 ? (
              <p className="bars-empty">No new page ideas from the last run.</p>
            ) : (
              liveIdeas.map((idea) => {
                const key = ideaKey(idea);
                return (
                  <div className="nested-box reactimus-item" key={key}>
                    <div className="reactimus-item-header">
                      <div>
                        <span className={`badge flag-${idea.priority}`}>{idea.priority}</span>{" "}
                        <strong>{idea.suggestedPageIdea}</strong>{" "}
                        <span className="badge">{idea.commercialOrInformational}</span>
                      </div>
                      <span className="reactimus-actions">
                        <ArchiveButton
                          suggestionKey={key}
                          entry={{
                            kind: "New page idea",
                            title: idea.suggestedPageIdea,
                            detail: `${idea.totalImpressions.toLocaleString("en-GB")} impressions`,
                          }}
                        />
                        <AddButton suggestionKey={key} />
                      </span>
                    </div>
                    <p style={{ margin: "6px 0" }}>{idea.whySeparatePage}</p>
                    <p className="section-desc" style={{ margin: "6px 0" }}>
                      {idea.totalImpressions.toLocaleString("en-GB")} impressions ·{" "}
                      {idea.supportingQueryVariants}
                      {idea.suggestedUrlSlug && <> · suggested URL: {idea.suggestedUrlSlug}</>}
                    </p>
                    {idea.cannibalisationCheck && (
                      <p className="section-desc" style={{ margin: "6px 0" }}>
                        {idea.cannibalisationCheck}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="card">
            <h2>Other recommendations</h2>
            <p className="section-desc">
              Smaller calls from the analysis (internal links, FAQ answers and similar).{" "}
              {snapshot.rejectedCount} low-value query group{snapshot.rejectedCount === 1 ? " was" : "s were"}{" "}
              rejected automatically.
            </p>
            {liveRecs.length === 0 ? (
              <p className="bars-empty">Nothing else to flag.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th>Type</th>
                      <th>Search group</th>
                      <th>Demand</th>
                      <th className="num">Priority</th>
                      <th className="num"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveRecs.map((rec) => {
                      const key = recKey(rec);
                      return (
                        <tr key={key}>
                          <td>{shortPath(rec.url)}</td>
                          <td>{rec.recommendationType.replace(/_/g, " ")}</td>
                          <td>{rec.canonicalQueryGroup}</td>
                          <td>{rec.searchDemandSummary}</td>
                          <td className="num">
                            <span className={`badge flag-${rec.priority}`}>{rec.priority}</span>
                          </td>
                          <td className="num">
                            <span className="reactimus-actions">
                              <ArchiveButton
                                suggestionKey={key}
                                entry={{
                                  kind: "Recommendation",
                                  title: `${rec.recommendationType.replace(/_/g, " ")}: "${rec.canonicalQueryGroup}" on ${shortPath(rec.url)}`,
                                  detail: rec.searchDemandSummary,
                                }}
                              />
                              <AddButton suggestionKey={key} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {archivedEntries.length > 0 && (
            <div className="card reactimus-archive">
              <details>
                <summary>
                  Archived suggestions ({archivedEntries.length}) — ruled out; these stay suppressed
                  on every future run
                </summary>
                <ul className="reactimus-archive-list">
                  {archivedEntries.map(([key, entry]) => (
                    <li key={key}>
                      <span>
                        <span className="badge">{entry.kind}</span> <strong>{entry.title}</strong>
                        {entry.detail && <span className="meta"> · {entry.detail}</span>}
                        <span className="meta">
                          {" "}
                          · archived {new Date(entry.archivedAt).toLocaleDateString("en-GB")}
                        </span>
                      </span>
                      <button
                        className="row-toggle"
                        onClick={() => restoreSuggestion(key)}
                        disabled={archivingKey === key}
                      >
                        {archivingKey === key ? "…" : "restore"}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </>
      )}
    </>
  );
}
