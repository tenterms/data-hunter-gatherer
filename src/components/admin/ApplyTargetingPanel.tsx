"use client";

import { useState } from "react";

/**
 * One-click load of the agreed targeting plan for this client: key pages
 * (with slider screens), content group URL filters and topic cluster query
 * filters. Replaces the key page list, upserts groups by name.
 */
export default function ApplyTargetingPanel({ clientKey }: { clientKey: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<string[]>([]);

  const apply = async () => {
    if (!window.confirm("Load the agreed pages, content groups and keyword filters for this client? The current key page list is replaced (groups with other names are left alone).")) {
      return;
    }
    setBusy(true);
    setMessage("Loading targeting plan…");
    const res = await fetch("/api/admin/apply-targeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey }),
    });
    const body = await res.json();
    setMessage(body.message ?? (body.ok ? "Done." : "Failed."));
    setDetail(body.detail ?? []);
    setBusy(false);
  };

  return (
    <div className="card">
      <h2>Agreed targeting plan</h2>
      <p className="section-desc">
        Load the signed-off setup for this client in one go: key pages with their report screens,
        content group URL filters, and keyword group filters (with synonyms, so Arborist also
        catches &ldquo;tree&rdquo;).
      </p>
      <button className="btn primary" onClick={apply} disabled={busy}>
        {busy ? "Loading…" : "Load pages + groups + filters"}
      </button>
      {message && <p className="meta">{message}</p>}
      {detail.length > 0 && (
        <ul className="meta">
          {detail.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
