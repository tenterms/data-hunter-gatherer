"use client";

import { useState } from "react";
import type { AiVisibilityReport, AiPromptResult, MentionStatus } from "@/lib/aiVisibility";

/**
 * AI visibility rows: one per prompt, with a logo chip per platform. Full
 * colour = the client is named in the answer; greyed = cited as a source
 * only; hidden = not present. Clicking a row opens the per-platform detail
 * with what each assistant said and the history across runs.
 */

const STATUS_LABEL: Record<MentionStatus, string> = {
  answer: "named in the answer",
  source: "cited as a source only",
  absent: "not mentioned",
  error: "query failed this run",
  not_configured: "platform not connected",
};

function Logo({
  logo,
  label,
  status,
}: {
  logo: string;
  label: string;
  status: MentionStatus | undefined;
}) {
  if (!status || status === "absent" || status === "error" || status === "not_configured") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo}
      alt={`${label}: ${STATUS_LABEL[status]}`}
      title={`${label}: ${STATUS_LABEL[status]}`}
      className={`ai-vis-logo${status === "source" ? " greyed" : ""}`}
    />
  );
}

function HistoryDots({
  history,
  platformId,
}: {
  history: Array<{ date: string; statuses: Partial<Record<string, MentionStatus>> }>;
  platformId: string;
}) {
  const recent = history.slice(-12);
  return (
    <span className="ai-vis-history">
      {recent.map((h) => {
        const status = h.statuses[platformId];
        const cls = status === "answer" ? "on" : status === "source" ? "half" : "off";
        return <span key={h.date} className={`dot ${cls}`} title={`${h.date}: ${status ? STATUS_LABEL[status] : "no data"}`} />;
      })}
    </span>
  );
}

export default function AiVisibilitySection({
  data,
  teamView,
}: {
  data: AiVisibilityReport;
  teamView: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [screen, setScreen] = useState(0);

  // Prompts sharing a group become slider screens (locations first, in
  // configured order, Sectors last by convention of the seed order);
  // ungrouped prompts fall into one screen.
  const screens: Array<{ label: string; prompts: typeof data.prompts }> = [];
  for (const prompt of data.prompts) {
    const label = (prompt.group ?? "").trim() || "All prompts";
    const existing = screens.find((g) => g.label === label);
    if (existing) existing.prompts.push(prompt);
    else screens.push({ label, prompts: [prompt] });
  }
  const paginated = screens.length > 1;
  const safeScreen = Math.min(screen, screens.length - 1);
  const current = screens[safeScreen];

  return (
    <div>
      <p className="section-desc">
        Latest check: {new Date(data.ranAt).toLocaleDateString("en-GB")}. A full-colour logo means the
        assistant names the business in its answer; a faded logo means it only cites the website as a
        source.
      </p>
      {paginated && (
        <div className="engine-switcher">
          <button
            type="button"
            className="btn"
            onClick={() => setScreen((safeScreen - 1 + screens.length) % screens.length)}
          >
            ‹ Prev
          </button>
          <span className="engine-label">
            <strong>{current.label}</strong> · {current.prompts.length} prompt
            {current.prompts.length === 1 ? "" : "s"} · {safeScreen + 1} of {screens.length}
          </span>
          <button type="button" className="btn" onClick={() => setScreen((safeScreen + 1) % screens.length)}>
            Next ›
          </button>
        </div>
      )}
      <div className="ai-vis-list">
        {current.prompts.map((p) => {
          const isOpen = open === p.promptKey;
          const byPlatform = new Map(p.results.map((r) => [r.platform, r]));
          const errors = p.results.filter((r) => r.status === "error").length;
          return (
            <div key={p.promptKey} className="ai-vis-row-wrap">
              <button
                type="button"
                className={`ai-vis-row${isOpen ? " open" : ""}`}
                onClick={() => setOpen(isOpen ? null : p.promptKey)}
              >
                <span className="ai-vis-prompt">{p.prompt}</span>
                <span className="ai-vis-logos">
                  {data.platforms.map((platform) => (
                    <Logo
                      key={platform.id}
                      logo={platform.logo}
                      label={platform.label}
                      status={byPlatform.get(platform.id)?.status}
                    />
                  ))}
                </span>
              </button>
              {isOpen && (
                <div className="ai-vis-detail">
                  {data.platforms.map((platform) => {
                    const result: AiPromptResult | undefined = byPlatform.get(platform.id);
                    if (!result || result.status === "not_configured") return null;
                    if (result.status === "error" && !teamView) return null;
                    return (
                      <div key={platform.id} className="ai-vis-platform">
                        <div className="ai-vis-platform-head">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={platform.logo} alt="" className={`ai-vis-logo${result.status === "source" ? " greyed" : ""}`} />
                          <strong>{platform.label}</strong>
                          <span className={`badge ai-${result.status}`}>{STATUS_LABEL[result.status]}</span>
                          <HistoryDots history={p.history} platformId={platform.id} />
                        </div>
                        {result.snippet && result.status !== "error" && (
                          <p className="ai-vis-snippet">&ldquo;{result.snippet}&rdquo;</p>
                        )}
                        {result.fullText && result.status !== "error" && (
                          <details className="ai-vis-full-wrap">
                            <summary className="meta">View full answer</summary>
                            <div className="ai-vis-full">{result.fullText}</div>
                          </details>
                        )}
                        {teamView && result.status === "error" && (
                          <p className="meta">{result.error}</p>
                        )}
                        {teamView && result.citedDomains && result.citedDomains.length > 0 && (
                          <p className="meta">Sources: {result.citedDomains.join(" · ")}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {teamView && errors > 0 && !isOpen && (
                <span className="meta"> {errors} platform quer{errors === 1 ? "y" : "ies"} failed this run</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
