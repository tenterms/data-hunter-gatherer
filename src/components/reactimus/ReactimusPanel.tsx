"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchivedSuggestion, ReactimusSnapshot } from "@/lib/reactimus";
import type { NewPageIdeaRow, RecommendationRow, SuggestedEditRow } from "@/reactimus/types";

/**
 * Reactimus per-client view: pick pages, run the analysis, then review the
 * suggestions grouped under each page. Pages not in a run keep the
 * suggestions from their previous run.
 */

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

export interface KeyPageOption {
  url: string;
  label: string;
  role: string;
}

export default function ReactimusPanel({
  clientKey,
  snapshot,
  keyPages,
}: {
  clientKey: string;
  snapshot: ReactimusSnapshot | null;
  keyPages: KeyPageOption[];
}) {
  const router = useRouter();
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [added, setAdded] = useState<Record<string, string>>(snapshot?.added ?? {});
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [archived, setArchived] = useState<Record<string, ArchivedSuggestion>>(
    snapshot?.archived ?? {},
  );
  const [archivingKey, setArchivingKey] = useState<string | null>(null);

  function toggleUrl(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function run() {
    setRunning(true);
    setMessage(null);
    setRunLog(null);
    try {
      const res = await fetch("/api/reactimus/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, urls: [...selectedUrls] }),
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
  const archivedEntries = Object.entries(archived).sort((a, b) =>
    b[1].archivedAt.localeCompare(a[1].archivedAt),
  );

  // Group everything by page, in key-page order; analysed pages without a
  // matching key page (e.g. removed since) go last.
  const analysedByUrl = new Map(
    (snapshot?.pagesAnalysed ?? []).map((p) => [normUrl(p.url), p]),
  );
  const orderedUrls: string[] = [];
  for (const p of keyPages) {
    if (analysedByUrl.has(normUrl(p.url))) orderedUrls.push(normUrl(p.url));
  }
  for (const p of snapshot?.pagesAnalysed ?? []) {
    if (!orderedUrls.includes(normUrl(p.url))) orderedUrls.push(normUrl(p.url));
  }
  const labelFor = (url: string) =>
    keyPages.find((p) => normUrl(p.url) === normUrl(url))?.label ?? "";

  const selectedCount = selectedUrls.size;

  return (
    <>
      {/* --- Page picker + run --- */}
      <div className="card">
        <h2>1. Pick pages to analyse</h2>
        <p className="section-desc">
          Tick 2–5 pages per run — a run pulls three months of search data and reads each live page,
          so smaller batches are quicker. Pages you don&apos;t re-run keep their previous
          suggestions.
        </p>
        <div className="reactimus-page-picker">
          {keyPages.map((p) => {
            const analysed = analysedByUrl.get(normUrl(p.url));
            return (
              <label key={p.url} className="reactimus-page-option">
                <input
                  type="checkbox"
                  checked={selectedUrls.has(p.url)}
                  onChange={() => toggleUrl(p.url)}
                />
                <span>
                  <strong>{p.label || shortPath(p.url)}</strong>{" "}
                  <span className="meta">{shortPath(p.url)}</span>{" "}
                  <span className="badge">{p.role.replace(/_/g, " ")}</span>
                  {analysed?.analysedAt && (
                    <span className="meta">
                      {" "}
                      · analysed {new Date(analysed.analysedAt).toLocaleDateString("en-GB")}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={run} disabled={running || selectedCount === 0}>
            {running
              ? "Analysing… (this can take a minute)"
              : selectedCount === 0
                ? "Select pages to run"
                : `Run analysis on ${selectedCount} page${selectedCount === 1 ? "" : "s"}`}
          </button>
          {selectedCount > 5 && (
            <span className="section-desc" style={{ margin: 0 }}>
              That&apos;s a big batch — it&apos;ll work, but 2–5 pages per run is quicker.
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
          <p className="section-desc" style={{ margin: "10px 0 0" }}>
            Last run {new Date(snapshot.generatedAt).toLocaleString("en-GB")} · data window{" "}
            {snapshot.window.start} to {snapshot.window.end} · {snapshot.property}
          </p>
        )}
      </div>

      {/* --- Suggestions, grouped by page --- */}
      {!snapshot ? (
        <div className="card">
          <p className="bars-empty">No analysis yet — pick some pages above and run.</p>
        </div>
      ) : (
        orderedUrls.map((url) => {
          const analysed = analysedByUrl.get(url)!;
          const pageEdits = liveEdits.filter((e) => normUrl(e.url) === url);
          const pageIdeas = liveIdeas.filter((i) => normUrl(i.sourceUrl) === url);
          const pageRecs = liveRecs.filter((r) => normUrl(r.url) === url);
          const label = labelFor(url);
          return (
            <div className="card" key={url}>
              <h2>
                {label || shortPath(analysed.url)}{" "}
                <a
                  href={analysed.url}
                  target="_blank"
                  rel="noreferrer"
                  className="reactimus-page-link"
                >
                  {shortPath(analysed.url)}
                </a>
              </h2>
              <p className="section-desc">
                {analysed.status}
                {analysed.analysedAt &&
                  ` · analysed ${new Date(analysed.analysedAt).toLocaleDateString("en-GB")}`}
              </p>

              {pageEdits.length === 0 && pageIdeas.length === 0 && pageRecs.length === 0 && (
                <p className="bars-empty">
                  Nothing outstanding for this page — suggestions were either archived or none were
                  found.
                </p>
              )}

              {pageEdits.map((edit) => {
                const key = editKey(edit);
                return (
                  <div className="nested-box reactimus-item" key={key}>
                    <div className="reactimus-item-header">
                      <div>
                        <span className={`badge flag-${edit.priority}`}>{edit.priority}</span>{" "}
                        <strong>{edit.editType}</strong>{" "}
                        <span className="meta">· {edit.whereOnPage}</span>
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
                    <p style={{ margin: "6px 0" }}>{edit.why}</p>
                    <pre className="reactimus-copy">{edit.suggestedCopy}</pre>
                    <p className="section-desc" style={{ margin: "6px 0 0" }}>
                      Targets: {edit.keywordsTargeted}
                    </p>
                  </div>
                );
              })}

              {pageIdeas.map((idea) => {
                const key = ideaKey(idea);
                return (
                  <div className="nested-box reactimus-item" key={key}>
                    <div className="reactimus-item-header">
                      <div>
                        <span className={`badge flag-${idea.priority}`}>{idea.priority}</span>{" "}
                        <strong>New page idea: {idea.suggestedPageIdea}</strong>{" "}
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
              })}

              {pageRecs.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 14 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Search group</th>
                        <th>Demand</th>
                        <th className="num">Priority</th>
                        <th className="num"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRecs.map((rec) => {
                        const key = recKey(rec);
                        return (
                          <tr key={key}>
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
          );
        })
      )}

      {/* --- Archive: ruled-out suggestions --- */}
      {archivedEntries.length > 0 && (
        <div className="card reactimus-archive">
          <details>
            <summary>
              Archived suggestions ({archivedEntries.length}) — ruled out; these stay suppressed on
              every future run
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
  );
}
