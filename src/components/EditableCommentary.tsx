"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SectionCommentary } from "@/lib/types";

/**
 * Team view of a commentary block: shows the final text with its source badge
 * and lets the team edit it in place. Saving stores the override (it survives
 * report regeneration); clearing the text reverts to the suggestion.
 */
export default function EditableCommentary({
  clientKey,
  periodKey,
  commentary,
}: {
  clientKey: string;
  periodKey: string;
  commentary: SectionCommentary | undefined;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!commentary) return null;

  const modeLabel =
    commentary.mode === "human_override"
      ? "edited by the team"
      : commentary.mode === "llm_draft"
        ? "AI draft — review before publishing"
        : "auto-written from the data";

  async function save(overrideText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, periodKey, section: commentary!.section, overrideText }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage(data.message);
      if (data.ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="commentary editing">
        <div className="meta">
          <span className="badge">editing</span>
          <span>Clear the box and save to revert to the suggested text.</span>
        </div>
        <textarea
          className="commentary-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.max(4, text.split("\n").length + 1)}
        />
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={() => save(text)} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="btn" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
          {commentary.overrideText && (
            <button className="btn" onClick={() => save("")} disabled={busy}>
              Revert to suggestion
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`commentary${commentary.mode === "human_override" ? " overridden" : ""}`}>
      <div className="meta">
        <span className="badge">{modeLabel}</span>
        <button
          className="btn"
          style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 12 }}
          onClick={() => {
            setText(commentary.finalText);
            setEditing(true);
          }}
        >
          Edit
        </button>
      </div>
      {commentary.finalText}
      {commentary.overrideText && (
        <details className="suggested-collapsed">
          <summary>Show the original suggestion</summary>
          <p>{commentary.suggestedText}</p>
        </details>
      )}
      {message && <p className="action-msg success">{message}</p>}
    </div>
  );
}
