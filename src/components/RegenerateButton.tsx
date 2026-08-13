"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Re-run report generation for this period without leaving the report. */
export default function RegenerateButton({ clientKey, periodKey }: { clientKey: string; periodKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const regenerate = async () => {
    setBusy(true);
    setMessage("Regenerating — pulling fresh data…");
    try {
      const res = await fetch("/api/admin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, periodKey }),
      });
      const body = await res.json();
      setMessage(body.message ?? (body.ok ? "Regenerated." : "Generation failed."));
      if (body.ok) router.refresh();
    } catch {
      setMessage("Generation failed — try again.");
    }
    setBusy(false);
  };

  return (
    <span>
      <button className="btn" onClick={regenerate} disabled={busy}>
        {busy ? "Regenerating…" : "Regenerate report"}
      </button>
      {message && <span className="meta" style={{ marginLeft: 8 }}>{message}</span>}
    </span>
  );
}
