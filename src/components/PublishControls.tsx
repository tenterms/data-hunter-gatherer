"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PublishState } from "@/lib/types";

/**
 * Publish a frozen copy of the report to an unguessable client link. Draft
 * edits stay private until "Publish update" is clicked again.
 */
export default function PublishControls({
  clientKey,
  periodKey,
  published,
}: {
  clientKey: string;
  periodKey: string;
  published: PublishState | null | undefined;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = published ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${published.token}` : null;

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/publish", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, periodKey }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage(data.message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="publish-bar">
      {published ? (
        <>
          <span className="badge live">published {new Date(published.publishedAt).toLocaleString("en-GB")}</span>
          <a href={`/share/${published.token}`} target="_blank" rel="noreferrer" className="btn">
            Open client view ↗
          </a>
          <button className="btn" onClick={copy}>
            {copied ? "Copied!" : "Copy client link"}
          </button>
          <button className="btn primary" onClick={() => call("POST")} disabled={busy}>
            {busy ? "Publishing…" : "Publish update"}
          </button>
          <button className="btn danger" onClick={() => call("DELETE")} disabled={busy}>
            Unpublish
          </button>
        </>
      ) : (
        <>
          <span className="badge">draft — not visible to the client</span>
          <button className="btn primary" onClick={() => call("POST")} disabled={busy}>
            {busy ? "Publishing…" : "Publish to client link"}
          </button>
        </>
      )}
      {message && <span className="action-msg success" style={{ margin: 0 }}>{message}</span>}
    </div>
  );
}
