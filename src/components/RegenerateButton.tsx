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
    setMessage("Starting…");
    try {
      const res = await fetch("/api/admin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, periodKey }),
      });
      const started = await res.json();
      if (!started.ok) {
        setMessage(started.message ?? "Couldn't start generation.");
        setBusy(false);
        return;
      }
      const statusUrl = `/api/admin/generate?clientKey=${encodeURIComponent(clientKey)}&periodKey=${encodeURIComponent(periodKey)}`;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const status = (await (await fetch(statusUrl)).json()) as {
          job: { finished: boolean; ok?: boolean; message?: string; log: string[] } | null;
        };
        if (!status.job) {
          setMessage("The server restarted mid-generation — try again.");
          break;
        }
        if (status.job.finished) {
          setMessage(status.job.message ?? "Done.");
          if (status.job.ok) router.refresh();
          break;
        }
        setMessage(status.job.log[status.job.log.length - 1] ?? "Generating…");
      }
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
