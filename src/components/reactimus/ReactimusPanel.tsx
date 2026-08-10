"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactimusAction, ReactimusSnapshot, ReactimusStatus } from "@/lib/reactimus";

/**
 * Reactimus results, laid out like the team's manual edit tracker: per page,
 * one row per keyword (direct synonyms grouped), with the action, rationale
 * and the exact before/after edit in columns across the row.
 */

interface PageOption {
  url: string;
  label: string;
  role: string;
}

interface Props {
  clientKey: string;
  snapshot: ReactimusSnapshot | null;
  keyPages: PageOption[];
}

const STATUS_LABELS: Record<ReactimusStatus, string> = {
  ready_to_review: "Ready to review",
  approved: "Approved",
  not_approved: "Not approved",
  implemented: "Implemented",
};

const shortPath = (url: string) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

async function post(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    log?: string[];
  };
  return { ok: res.ok && data.ok !== false, message: data.message ?? "", log: data.log ?? [] };
}

export default function ReactimusPanel({ clientKey, snapshot, keyPages }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const analysedAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of snapshot?.pagesAnalysed ?? []) {
      if (p.analysedAt) map.set(p.url.replace(/\/+$/, ""), p.analysedAt);
    }
    return map;
  }, [snapshot]);

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const run = async () => {
    setRunning(true);
    setMessage("");
    setLog([]);
    const result = await post("/api/reactimus/run", { clientKey, urls: [...selected] });
    setLog(result.log);
    setMessage(result.ok ? "Analysis complete." : result.message || "Analysis failed.");
    setRunning(false);
    router.refresh();
  };

  // Group live actions by the page they're filed under.
  const live = (snapshot?.actions ?? []).filter((a) => !snapshot?.archived[a.key]);
  const byPage = new Map<string, ReactimusAction[]>();
  for (const a of live) {
    const key = a.pageUrl.replace(/\/+$/, "");
    const list = byPage.get(key) ?? [];
    list.push(a);
    byPage.set(key, list);
  }
  const pageOrder = [...byPage.keys()].sort((a, b) => (byPage.get(b)?.length ?? 0) - (byPage.get(a)?.length ?? 0));
  const labelFor = (url: string) =>
    keyPages.find((p) => p.url.replace(/\/+$/, "") === url)?.label ?? shortPath(url);

  const archivedEntries = Object.entries(snapshot?.archived ?? {}).sort((a, b) =>
    b[1].archivedAt.localeCompare(a[1].archivedAt),
  );

  return (
    <>
      {/* 1. Page picker */}
      <div className="card">
        <h2>1. Pick pages to analyse</h2>
        <p className="section-desc">
          Tick the pages you want suggestions for. Each run replaces those pages&apos; rows from
          scratch; other pages keep their latest results.
        </p>
        <div className="reactimus-page-picker">
          {keyPages.map((p) => {
            const when = analysedAt.get(p.url.replace(/\/+$/, ""));
            return (
              <label key={p.url} className="reactimus-page-option">
                <input
                  type="checkbox"
                  checked={selected.has(p.url)}
                  onChange={() => toggle(p.url)}
                  disabled={running}
                />
                <span>
                  <strong>{p.label}</strong>{" "}
                  <span className="meta">
                    {shortPath(p.url)}
                    {p.role ? ` · ${p.role}` : ""}
                    {when ? ` · analysed ${new Date(when).toLocaleDateString("en-GB")}` : ""}
                  </span>
                </span>
              </label>
            );
          })}
          {keyPages.length === 0 && <p className="meta">No pages available yet.</p>}
        </div>
        {selected.size > 5 && (
          <p className="meta" style={{ color: "var(--electric-orange, #ff8c55)" }}>
            {selected.size} pages selected — runs work best 2–5 pages at a time.
          </p>
        )}
        <p>
          <button className="btn" onClick={run} disabled={running || selected.size === 0}>
            {running ? "Analysing…" : `Run analysis (${selected.size} page${selected.size === 1 ? "" : "s"})`}
          </button>{" "}
          {message && <span className="meta">{message}</span>}
        </p>
        {log.length > 0 && (
          <pre className="test-output" style={{ maxHeight: 180, overflow: "auto" }}>
            {log.join("\n")}
          </pre>
        )}
      </div>

      {/* 2. Results, one table per page */}
      {snapshot &&
        pageOrder.map((pageUrl) => (
          <PageTable
            key={pageUrl}
            clientKey={clientKey}
            pageUrl={pageUrl}
            label={labelFor(pageUrl)}
            actions={byPage.get(pageUrl)!}
            added={snapshot.added}
            onChanged={() => router.refresh()}
          />
        ))}
      {snapshot && live.length === 0 && (
        <div className="card">
          <p className="meta">No live suggestions — run the analysis on some pages above.</p>
        </div>
      )}

      {/* 3. Archive */}
      {archivedEntries.length > 0 && (
        <div className="card reactimus-archive">
          <details>
            <summary>
              Archive — {archivedEntries.length} ruled-out suggestion
              {archivedEntries.length === 1 ? "" : "s"} (never shown again unless restored)
            </summary>
            <ul className="reactimus-archive-list">
              {archivedEntries.map(([key, entry]) => (
                <li key={key}>
                  <span>
                    <strong>{entry.kind}</strong> · {entry.title}{" "}
                    <span className="meta">{entry.detail}</span>
                  </span>
                  <RowButton
                    label="Restore"
                    onClick={async () => {
                      await post("/api/reactimus/archive", { clientKey, key, action: "restore" });
                      router.refresh();
                    }}
                  />
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </>
  );
}

function PageTable({
  clientKey,
  pageUrl,
  label,
  actions,
  added,
  onChanged,
}: {
  clientKey: string;
  pageUrl: string;
  label: string;
  actions: ReactimusAction[];
  added: Record<string, string>;
  onChanged: () => void;
}) {
  const ordered = [...actions].sort((a, b) => b.impressions - a.impressions);
  return (
    <div className="card">
      <h2>
        {label}{" "}
        <a href={pageUrl} target="_blank" rel="noreferrer" className="meta">
          {shortPath(pageUrl)}
        </a>
      </h2>
      <div className="scroll-x">
        <table className="reactimus-table">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Action</th>
              <th>Rationale</th>
              <th>Before</th>
              <th>After</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((a) => (
              <ActionRow
                key={a.key}
                clientKey={clientKey}
                action={a}
                addedPeriod={added[a.key]}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionRow({
  clientKey,
  action,
  addedPeriod,
  onChanged,
}: {
  clientKey: string;
  action: ReactimusAction;
  addedPeriod?: string;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<ReactimusStatus>(action.status);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const changeStatus = async (next: ReactimusStatus) => {
    setStatus(next);
    await post("/api/reactimus/status", { clientKey, key: action.key, status: next });
  };

  const variantCount = action.variants ? action.variants.split(";").length : 1;
  return (
    <tr className={status === "not_approved" ? "row-dimmed" : undefined}>
      <td className="reactimus-kw">
        <strong>{action.keyword}</strong>
        <span className="meta" title={action.variants}>
          {variantCount > 1 ? `${variantCount} variants · ` : ""}
          {action.impressions > 0 ? `${action.impressions.toLocaleString("en-GB")} impressions` : ""}
        </span>
      </td>
      <td>
        <span className={`reactimus-action-badge badge-${action.action.toLowerCase().replace(/\s+/g, "-")}`}>
          {action.action}
        </span>
        {action.targetUrl && (
          <span className="meta" style={{ display: "block" }}>
            → {shortPath(action.targetUrl)}
          </span>
        )}
      </td>
      <td className="reactimus-rationale" title={action.why}>
        {action.rationale}
      </td>
      <td className="reactimus-copy-cell">
        {action.before ? <pre>{action.before}</pre> : <span className="meta">(new addition)</span>}
      </td>
      <td className="reactimus-copy-cell">
        <pre>{action.after}</pre>
      </td>
      <td>
        <select
          className="reactimus-status"
          value={status}
          onChange={(e) => changeStatus(e.target.value as ReactimusStatus)}
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td className="reactimus-controls">
        {addedPeriod ? (
          <span className="meta">In report ({addedPeriod})</span>
        ) : (
          <RowButton
            label={busy ? "…" : "Add to report"}
            onClick={async () => {
              setBusy(true);
              const r = await post("/api/reactimus/add", { clientKey, key: action.key });
              setNote(r.message);
              setBusy(false);
              onChanged();
            }}
          />
        )}
        <RowButton
          label="Archive"
          subtle
          onClick={async () => {
            await post("/api/reactimus/archive", { clientKey, key: action.key, action: "archive" });
            onChanged();
          }}
        />
        {note && <span className="meta">{note}</span>}
      </td>
    </tr>
  );
}

function RowButton({
  label,
  subtle,
  onClick,
}: {
  label: string;
  subtle?: boolean;
  onClick: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={subtle ? "btn btn-subtle" : "btn"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onClick();
        setBusy(false);
      }}
    >
      {label}
    </button>
  );
}
