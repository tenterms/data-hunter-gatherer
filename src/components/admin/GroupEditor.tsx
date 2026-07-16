"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EditableGroup, GroupKind, PreviewResult } from "@/lib/groupEditor";
import ChipsInput from "./ChipsInput";

/**
 * SEOGets-style group editor: pick or create a group, edit its name and its
 * contains / doesn't-contain terms, and watch the list of matching queries
 * (or pages) update live from the client's real GSC data.
 */

interface DraftState {
  key: string | null; // null = creating a new group
  name: string;
  contains: string[];
  notContains: string[];
  advancedRules: number;
}

const EMPTY_DRAFT: DraftState = { key: null, name: "", contains: [], notContains: [], advancedRules: 0 };

export default function GroupEditor({
  clientKey,
  kind,
  items,
}: {
  clientKey: string;
  kind: GroupKind;
  items: EditableGroup[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noun = kind === "topic" ? "queries" : "pages";

  const fetchPreview = useCallback(
    (contains: string[], notContains: string[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setPreviewLoading(true);
        try {
          const res = await fetch("/api/admin/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientKey, kind, contains, notContains }),
          });
          setPreview((await res.json()) as PreviewResult);
        } catch {
          setPreview(null);
        } finally {
          setPreviewLoading(false);
        }
      }, 350);
    },
    [clientKey, kind],
  );

  useEffect(() => {
    if (draft) fetchPreview(draft.contains, draft.notContains);
  }, [draft, fetchPreview]);

  function openEditor(item: EditableGroup | null) {
    setMessage(null);
    setPreview(null);
    setDraft(
      item
        ? {
            key: item.key,
            name: item.name,
            contains: item.contains,
            notContains: item.notContains,
            advancedRules: item.advancedRules,
          }
        : EMPTY_DRAFT,
    );
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey,
          kind,
          key: draft.key ?? undefined,
          name: draft.name,
          contains: draft.contains,
          notContains: draft.notContains,
        }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage({ ok: data.ok, text: data.message });
      if (data.ok) {
        setDraft(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.key) return;
    if (!confirm(`Remove "${draft.name}"? The report will no longer show this group.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey, kind, key: draft.key }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setMessage({ ok: data.ok, text: data.message });
      if (data.ok) {
        setDraft(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Existing groups */}
      <ul className="report-list">
        {items.map((item) => (
          <li key={item.key}>
            <div>
              <strong>{item.name}</strong>
              <div className="meta">
                contains: {item.contains.join(", ") || "—"}
                {item.notContains.length > 0 && <> · doesn&apos;t contain: {item.notContains.join(", ")}</>}
                {item.advancedRules > 0 && <> · +{item.advancedRules} advanced rule(s) from the sheet</>}
              </div>
            </div>
            <button className="btn" onClick={() => openEditor(item)}>
              Edit
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p className="bars-empty">Nothing set up yet — create the first one below.</p>}

      {draft === null ? (
        <button className="btn primary" onClick={() => openEditor(null)}>
          + New {kind === "topic" ? "topic cluster" : "content group"}
        </button>
      ) : (
        <div className="editor-panel">
          <div className="form-row">
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={kind === "topic" ? "e.g. Baby Product Design" : "e.g. Blog"}
              />
            </label>
          </div>

          <label className="chips-label">
            {kind === "topic" ? "Query contains any of…" : "Page URL contains any of…"}
            <ChipsInput
              value={draft.contains}
              onChange={(contains) => setDraft({ ...draft, contains })}
              placeholder={kind === "topic" ? "query or keyword" : "url fragment, e.g. /blog/"}
            />
          </label>
          <label className="chips-label">
            …and doesn&apos;t contain
            <ChipsInput
              value={draft.notContains}
              onChange={(notContains) => setDraft({ ...draft, notContains })}
              placeholder="optional exclusions"
            />
          </label>
          {draft.advancedRules > 0 && (
            <p className="section-desc">
              This group also has {draft.advancedRules} advanced rule(s) (exact/regex/starts-with) managed in
              the sheet — they&apos;re kept as-is when you save.
            </p>
          )}

          <div className="btn-row" style={{ margin: "12px 0" }}>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
              Cancel
            </button>
            {draft.key && (
              <button className="btn danger" onClick={remove} disabled={busy}>
                Remove
              </button>
            )}
          </div>

          {/* Live preview */}
          <div className="preview-panel">
            {previewLoading && <p className="section-desc">Checking matches…</p>}
            {preview && !previewLoading && (
              <>
                {preview.message ? (
                  <p className="section-desc">{preview.message}</p>
                ) : (
                  <>
                    <p className="preview-count">
                      <strong>{preview.totalMatches.toLocaleString("en-GB")}</strong> matching {noun}
                      {preview.periodLabel && <> · {preview.periodLabel}</>} ·{" "}
                      {preview.totalClicks.toLocaleString("en-GB")} clicks ·{" "}
                      {preview.totalImpressions.toLocaleString("en-GB")} impressions
                    </p>
                    <ul className="preview-list">
                      {preview.rows.map((row) => (
                        <li key={row.text}>
                          <span className="preview-text">
                            {kind === "content" ? row.text.replace(/^https?:\/\/[^/]+/, "") || "/" : row.text}
                          </span>
                          <span className="preview-nums">
                            {row.clicks.toLocaleString("en-GB")} clicks · {row.impressions.toLocaleString("en-GB")} impr.
                          </span>
                        </li>
                      ))}
                      {preview.totalMatches > preview.rows.length && (
                        <li className="meta">+ {preview.totalMatches - preview.rows.length} more</li>
                      )}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {message && <p className={`action-msg ${message.ok ? "success" : "error"}`}>{message.text}</p>}
    </div>
  );
}
