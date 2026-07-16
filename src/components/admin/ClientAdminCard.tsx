"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClientOverview } from "@/lib/adminActions";
import { ActionMessage, useAction } from "./useAction";

/**
 * Per-client admin panel: generate reports for each month, add a new month,
 * and upload a rankings CSV — all buttons, no commands.
 */
export default function ClientAdminCard({
  overview,
  sheetUrl,
}: {
  overview: ClientOverview;
  sheetUrl: string | null;
}) {
  const { client, periods, counts } = overview;
  const generate = useAction();
  const addMonth = useAction();
  const upload = useAction();
  const [month, setMonth] = useState("");
  const [uploadPeriod, setUploadPeriod] = useState(periods[0]?.period_key ?? "");
  const [busyPeriod, setBusyPeriod] = useState<string | null>(null);

  async function generateFor(periodKey: string) {
    setBusyPeriod(periodKey);
    await generate.run("/api/admin/generate", { clientKey: client.client_key, periodKey });
    setBusyPeriod(null);
  }

  async function submitMonth(e: React.FormEvent) {
    e.preventDefault();
    const ok = await addMonth.run("/api/admin/periods", { clientKey: client.client_key, month });
    if (ok) setMonth("");
  }

  async function submitUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("clientKey", client.client_key);
    form.set("periodKey", uploadPeriod);
    await upload.run("/api/admin/import-rankings", form);
  }

  return (
    <div className="card">
      <div className="bars-header">
        <h2>{client.client_name}</h2>
        <span className="badge">{client.domain}</span>
      </div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <Link className="btn" href={`/admin/${client.client_key}/content-groups`}>
          Content groups ({counts.contentGroups})
        </Link>
        <Link className="btn" href={`/admin/${client.client_key}/topic-clusters`}>
          Topic clusters ({counts.topicClusters})
        </Link>
        {sheetUrl && (
          <a className="btn" href={sheetUrl} target="_blank" rel="noreferrer">
            Open config sheet ↗
          </a>
        )}
      </div>
      <p className="section-desc">
        {counts.pages} key pages · {counts.drawTasks} DRAW tasks · {counts.rankingImports} ranking rows —
        pages, DRAW tasks and commentary overrides are edited in the sheet (filter by{" "}
        <code>client_key = {client.client_key}</code>); content groups and topic clusters are edited here
        with a live match preview.
      </p>

      <h3>Monthly reports</h3>
      {periods.length === 0 ? (
        <p className="bars-empty">No reporting months yet — add one below.</p>
      ) : (
        <ul className="report-list">
          {periods.map((p) => (
            <li key={p.period_key}>
              <div>
                <strong>{p.label || p.period_key}</strong>{" "}
                <span className="meta">
                  {p.start_date} – {p.end_date}
                </span>
              </div>
              <div className="btn-row">
                {p.hasSnapshot && (
                  <Link className="btn" href={`/reports/${client.client_key}/${p.period_key}`}>
                    View report
                  </Link>
                )}
                <button
                  className="btn primary"
                  disabled={busyPeriod !== null}
                  onClick={() => generateFor(p.period_key)}
                >
                  {busyPeriod === p.period_key
                    ? "Generating…"
                    : p.hasSnapshot
                      ? "Regenerate"
                      : "Generate report"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ActionMessage state={generate.state} />

      <div className="admin-subgrid">
        <form onSubmit={submitMonth} className="admin-form">
          <h3>Add a reporting month</h3>
          <div className="form-row">
            <label>
              Month
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
            </label>
            <button className="btn" disabled={addMonth.state.busy} type="submit">
              {addMonth.state.busy ? "Adding…" : "Add month"}
            </button>
          </div>
          <p className="section-desc">Compared automatically against the month before it.</p>
          <ActionMessage state={addMonth.state} />
        </form>

        <form onSubmit={submitUpload} className="admin-form">
          <h3>Upload rankings CSV</h3>
          <div className="form-row">
            <label>
              Month
              <select value={uploadPeriod} onChange={(e) => setUploadPeriod(e.target.value)}>
                {periods.map((p) => (
                  <option key={p.period_key} value={p.period_key}>
                    {p.label || p.period_key}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CSV file
              <input type="file" name="file" accept=".csv,text/csv" required />
            </label>
            <button className="btn" disabled={upload.state.busy || periods.length === 0} type="submit">
              {upload.state.busy ? "Importing…" : "Import"}
            </button>
          </div>
          <p className="section-desc">
            An SE Ranking export works as-is (keyword, start/end position, volume…). Regenerate the report
            after importing.
          </p>
          <ActionMessage state={upload.state} />
        </form>
      </div>
    </div>
  );
}
