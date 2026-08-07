"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Account Manager Assistant (team view only). The AM lists the month's
 * priorities, client concerns and in-flight work; saved notes are handed to
 * the commentary writer on the next Generate so the whole report talks about
 * what actually matters this month.
 */
export default function FocusNotesPanel({
  clientKey,
  periodKey,
  initialNotes,
}: {
  clientKey: string;
  periodKey: string;
  initialNotes: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialNotes.trim() === "");
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/focus-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, periodKey, notes }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage(data.message);
      if (data.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card focus-notes">
      <div className="focus-notes-header">
        <h2>Account manager assistant</h2>
        <button className="row-toggle" onClick={() => setOpen(!open)}>
          {open ? "collapse" : initialNotes.trim() ? "edit" : "add notes"}
        </button>
      </div>
      <p className="section-desc">
        What matters this month? List the priorities, what the client is worried about, and what
        we&apos;ve been working on (e.g. &ldquo;launched a new page about raw dog food&rdquo;). The
        auto-written commentary is briefed with these notes when you generate the report, so it
        focuses on the right things. Clients never see this box.
      </p>
      {open ? (
        <>
          <textarea
            className="commentary-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={Math.max(4, notes.split("\n").length + 1)}
            placeholder={
              "- Biggest priority this month: …\n- Client is concerned about: …\n- We've been fixing / launched: …"
            }
          />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save notes"}
            </button>
            {message && <span className="action-msg success" style={{ margin: 0 }}>{message}</span>}
          </div>
        </>
      ) : (
        initialNotes.trim() !== "" && <p className="focus-notes-body">{initialNotes}</p>
      )}
    </div>
  );
}
