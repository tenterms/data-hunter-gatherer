"use client";

import { useState } from "react";
import type { CannibalisationSetting, EngineSetting } from "@/lib/reportSettings";
import { ActionMessage, useAction } from "./useAction";

/**
 * Report display settings for one client:
 *  - search engine order/visibility/labels (the rankings slider)
 *  - cannibalisation rows shown or hidden in the report
 */
export default function ReportSettingsPanel({
  clientKey,
  initialEngines,
  initialCannibalisation,
}: {
  clientKey: string;
  initialEngines: EngineSetting[];
  initialCannibalisation: CannibalisationSetting[];
}) {
  return (
    <>
      <EnginesCard clientKey={clientKey} initialEngines={initialEngines} />
      <CannibalisationCard clientKey={clientKey} initialRows={initialCannibalisation} />
    </>
  );
}

function EnginesCard({
  clientKey,
  initialEngines,
}: {
  clientKey: string;
  initialEngines: EngineSetting[];
}) {
  const { state, run } = useAction();
  const [engines, setEngines] = useState<EngineSetting[]>(initialEngines);

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= engines.length) return;
    const next = [...engines];
    [next[index], next[target]] = [next[target], next[index]];
    setEngines(next);
  }

  function update(index: number, patch: Partial<EngineSetting>) {
    setEngines(engines.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  async function save() {
    await run("/api/admin/ranking-engines", {
      clientKey,
      engines: engines.map((e) => ({ id: e.id, label: e.label, active: e.active })),
    });
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Search engines (rankings slider)</h3>
      <p className="section-desc">
        The visibility section shows one panel per SE Ranking search engine (e.g. one per target
        location) with next/previous controls. Drag the order with the arrows, rename the labels, and
        hide any engine the client shouldn&apos;t see.
      </p>
      {engines.length === 0 ? (
        <p className="bars-empty">
          No search engines found yet — generate a report with SE Ranking connected and they&apos;ll
          appear here.
        </p>
      ) : (
        <>
          {engines.map((engine, i) => (
            <div className="engine-setting-row" key={engine.id}>
              <span className="order-buttons">
                <button className="row-toggle" onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button
                  className="row-toggle"
                  onClick={() => move(i, 1)}
                  disabled={i === engines.length - 1}
                >
                  ↓
                </button>
              </span>
              <input
                value={engine.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder={engine.defaultLabel}
              />
              <span className="section-desc" style={{ margin: 0 }}>
                {engine.keywordsTracked > 0 ? `${engine.keywordsTracked} keywords` : "no data yet"}
              </span>
              <button
                className={`row-toggle ${engine.active ? "" : "off"}`}
                onClick={() => update(i, { active: !engine.active })}
              >
                {engine.active ? "shown" : "hidden"}
              </button>
            </div>
          ))}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={save} disabled={state.busy}>
              {state.busy ? "Saving…" : "Save search engines"}
            </button>
          </div>
        </>
      )}
      <ActionMessage state={state} />
    </div>
  );
}

function CannibalisationCard({
  clientKey,
  initialRows,
}: {
  clientKey: string;
  initialRows: CannibalisationSetting[];
}) {
  const { state, run } = useAction();
  const [rows, setRows] = useState<CannibalisationSetting[]>(initialRows);

  function toggle(query: string) {
    setRows(rows.map((r) => (r.query === query ? { ...r, hidden: !r.hidden } : r)));
  }

  async function save() {
    await run("/api/admin/cannibalisation", {
      clientKey,
      hiddenQueries: rows.filter((r) => r.hidden).map((r) => r.query),
    });
  }

  const hiddenCount = rows.filter((r) => r.hidden).length;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Cannibalisation catcher — curate the list</h3>
      <p className="section-desc">
        Every query below has more than one page competing in search. Hide the rows that aren&apos;t
        worth the client&apos;s attention (brand terms, false positives); hidden rows stay out of the
        report until you show them again.
      </p>
      {rows.length === 0 ? (
        <p className="bars-empty">No cannibalisation issues in the latest report.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Query</th>
                  <th className="num">Pages</th>
                  <th className="num">Clicks</th>
                  <th className="num">Impressions</th>
                  <th className="num">In report?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.query} style={row.hidden ? { opacity: 0.5 } : undefined}>
                    <td>{row.query}</td>
                    <td className="num">{row.pageCount}</td>
                    <td className="num">{row.clicks.toLocaleString("en-GB")}</td>
                    <td className="num">{row.impressions.toLocaleString("en-GB")}</td>
                    <td className="num">
                      <button
                        className={`row-toggle ${row.hidden ? "off" : ""}`}
                        onClick={() => toggle(row.query)}
                      >
                        {row.hidden ? "hidden" : "shown"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={save} disabled={state.busy}>
              {state.busy ? "Saving…" : `Save (${hiddenCount} hidden)`}
            </button>
          </div>
        </>
      )}
      <ActionMessage state={state} />
    </div>
  );
}
