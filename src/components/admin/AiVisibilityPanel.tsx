"use client";

import { useCallback, useEffect, useState } from "react";

interface Status {
  promptCount: number;
  platforms: Array<{ id: string; label: string; logo: string; configured: boolean }>;
  runCount: number;
  lastRunAt: string | null;
}

/** Run AI visibility checks for this client and see what's configured. */
export default function AiVisibilityPanel({ clientKey }: { clientKey: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/ai-visibility?clientKey=${encodeURIComponent(clientKey)}`);
    setStatus((await res.json()) as Status);
  }, [clientKey]);

  useEffect(() => {
    load().catch(() => setMessage("Couldn't load AI visibility status."));
  }, [load]);

  const run = async () => {
    setBusy(true);
    setMessage("Running — one live query per prompt per platform, this takes a few minutes…");
    try {
      const res = await fetch("/api/admin/ai-visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey }),
      });
      const body = await res.json();
      setMessage(body.message ?? (body.ok ? "Done." : "Run failed."));
    } catch {
      setMessage("Run failed — try again.");
    }
    setBusy(false);
    await load();
  };

  if (!status) {
    return (
      <div className="card">
        <h2>AI visibility</h2>
        <p className="meta">{message || "Checking configuration…"}</p>
      </div>
    );
  }

  const configured = status.platforms.filter((p) => p.configured);
  const missing = status.platforms.filter((p) => !p.configured);

  return (
    <div className="card">
      <h2>AI visibility</h2>
      <p className="section-desc">
        Asks the AI assistants this client&apos;s real customer questions and records whether the
        business appears in their answers. Results land in the report&apos;s AI visibility section
        after the next regenerate; every run adds to the history.
      </p>
      <p className="meta">
        {status.promptCount} prompt{status.promptCount === 1 ? "" : "s"} configured ·{" "}
        {configured.map((p) => p.label).join(", ") || "no platforms connected"}
        {missing.length > 0 && ` (waiting on keys: ${missing.map((p) => p.label).join(", ")})`}
        {status.lastRunAt &&
          ` · last run ${new Date(status.lastRunAt).toLocaleString("en-GB")} (${status.runCount} run${status.runCount === 1 ? "" : "s"} stored)`}
      </p>
      <button className="btn primary" onClick={run} disabled={busy || status.promptCount === 0 || configured.length === 0}>
        {busy ? "Running…" : "Run AI visibility check"}
      </button>
      {status.promptCount === 0 && (
        <p className="meta">No prompts yet — load the agreed targeting plan, or add rows to the AiSearchPrompts tab.</p>
      )}
      {message && <p className="meta">{message}</p>}
    </div>
  );
}
