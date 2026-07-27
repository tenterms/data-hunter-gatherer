"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClientOverview } from "@/lib/adminActions";
import { ActionMessage, useAction } from "./useAction";

/**
 * A client's admin overview: monthly reports (generate / view / work grid /
 * publish state), add a month, and the rankings import.
 */
export default function ClientOverviewPanel({ overview }: { overview: ClientOverview }) {
  const { client, periods } = overview;
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
    <>
      <div className="card">
        <h2>Monthly reports</h2>
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
                  <Link className="btn" href={`/admin/${client.client_key}/draw/${p.period_key}`}>
                    Work grid
                  </Link>
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

        <form onSubmit={submitMonth} className="admin-form" style={{ marginTop: 12 }}>
          <div className="form-row">
            <label>
              Add a reporting month
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
            </label>
            <button className="btn" disabled={addMonth.state.busy} type="submit">
              {addMonth.state.busy ? "Adding…" : "Add month"}
            </button>
          </div>
          <ActionMessage state={addMonth.state} />
        </form>
      </div>

      <div className="card">
        <h2>Rankings import</h2>
        <p className="section-desc">
          With an SE Ranking API key configured, rankings are pulled automatically when you generate a
          report. This upload is the manual fallback (an SE Ranking CSV export works as-is).
        </p>
        <form onSubmit={submitUpload} className="admin-form">
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
          <ActionMessage state={upload.state} />
        </form>
      </div>
    </>
  );
}
