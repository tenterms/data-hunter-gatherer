"use client";

import { useState } from "react";
import { ActionMessage, useAction } from "./useAction";

export default function NewClientForm() {
  const { state, run } = useAction();
  const [clientName, setClientName] = useState("");
  const [domain, setDomain] = useState("");
  const [firstMonth, setFirstMonth] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run("/api/admin/clients", { clientName, domain, firstMonth: firstMonth || undefined });
    if (ok) {
      setClientName("");
      setDomain("");
      setFirstMonth("");
    }
  }

  return (
    <form onSubmit={submit} className="admin-form">
      <div className="form-row">
        <label>
          Client name
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="e.g. Acme Widgets"
            required
          />
        </label>
        <label>
          Website
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="e.g. acmewidgets.co.uk"
            required
          />
        </label>
        <label>
          First report month
          <input type="month" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} />
        </label>
        <button className="btn primary" disabled={state.busy} type="submit">
          {state.busy ? "Creating…" : "Create client"}
        </button>
      </div>
      <p className="section-desc" style={{ marginTop: 8 }}>
        This sets up the client with their homepage and first reporting month. Leave the month blank to use
        the most recent full month. Add their key pages, content groups and topic clusters in the Google
        Sheet afterwards.
      </p>
      <ActionMessage state={state} />
    </form>
  );
}
