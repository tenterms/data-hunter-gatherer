import type { CommentarySection, ReportSnapshot } from "@/lib/types";
import KpiCard from "@/components/KpiCard";
import ReportSection from "@/components/ReportSection";
import CommentaryBlock from "@/components/CommentaryBlock";
import EditableCommentary from "@/components/EditableCommentary";
import PerformanceBars from "@/components/PerformanceBars";
import PagesTable from "@/components/PagesTable";
import CannibalisationTable from "@/components/CannibalisationTable";
import RankingsSection from "@/components/RankingsSection";
import DrawGrid from "@/components/DrawGrid";
import ChangeBadge from "@/components/ChangeBadge";

/**
 * The report itself, shared by two routes:
 *  - team mode: editable commentary, raw-data panel, internal badges
 *  - client mode: read-only, clean, no internals
 *
 * Section order (agreed with the team): executive summary → KPI cards →
 * work grid → strategic priorities → traffic (GSC, incl. content & keyword
 * group performance) → visibility (rankings, per search engine) →
 * cannibalisation.
 */
export default function ReportView({
  snapshot,
  mode,
}: {
  snapshot: ReportSnapshot;
  mode: "team" | "client";
}) {
  const { metrics } = snapshot;
  const clientKey = snapshot.client.client_key;
  const periodKey = snapshot.period.period_key;

  const commentaryFor = (section: CommentarySection) =>
    snapshot.commentary.find((c) => c.section === section);

  const Commentary = ({ section }: { section: CommentarySection }) =>
    mode === "team" ? (
      <EditableCommentary clientKey={clientKey} periodKey={periodKey} commentary={commentaryFor(section)} />
    ) : (
      <CommentaryBlock commentary={commentaryFor(section)} readOnly />
    );

  const primaryPages = metrics.pages.filter((p) => p.pageRole === "primary");
  const secondaryPages = metrics.pages.filter((p) => p.pageRole === "secondary");
  const supportingPages = metrics.pages.filter((p) => p.pageRole === "supporting");
  const rest = metrics.restOfSite;

  return (
    <>
      {/* 1. Executive summary */}
      <ReportSection title="Executive summary">
        <Commentary section="executive_summary" />
      </ReportSection>

      {/* 2. Top-level data cards */}
      <div className="kpi-grid">
        {snapshot.kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>

      {/* 3. Work grid (DRAW) */}
      <ReportSection
        title="Work completed &amp; planned"
        description="Priority tasks this month and what we did last month, across the four DRAW workstreams."
      >
        <DrawGrid
          tasks={snapshot.drawTasks}
          editable={mode === "team" ? { clientKey, periodKey } : undefined}
        />
      </ReportSection>

      {/* 4. Strategic priorities */}
      <ReportSection title="Strategic priorities">
        <Commentary section="strategic_priorities" />
        {snapshot.strategicNotes.length > 0 && (
          <ul>
            {snapshot.strategicNotes.map((note, i) => (
              <li key={`${note.title}-${i}`} style={{ marginBottom: 8 }}>
                <strong>{note.title}</strong>
                {note.priority && (
                  <span className={`badge flag-${note.priority}`} style={{ marginLeft: 8 }}>
                    {note.priority}
                  </span>
                )}
                <div style={{ color: "var(--ink-secondary)", fontSize: 14 }}>{note.body}</div>
              </li>
            ))}
          </ul>
        )}
      </ReportSection>

      {/* 5. Traffic changes (GSC) */}
      <ReportSection
        title="Traffic changes (Google Search Console)"
        description="Clicks, impressions, CTR and average position for the key pages, current period vs comparison period."
      >
        <Commentary section="traffic" />
        {primaryPages.length > 0 && (
          <>
            <h3>Primary pages</h3>
            <PagesTable pages={primaryPages} />
          </>
        )}
        {secondaryPages.length > 0 && (
          <>
            <h3>Secondary pages</h3>
            <PagesTable pages={secondaryPages} />
          </>
        )}
        {supportingPages.length > 0 && (
          <>
            <h3>Supporting &amp; blog content</h3>
            <PagesTable pages={supportingPages} />
          </>
        )}
        <div className="nested-box">
          <h3>Rest of site</h3>
          <p className="section-desc">
            Everything beyond the tracked key pages — {rest.pageCount.toLocaleString("en-GB")} URLs
            picking up search traffic across the wider site.
          </p>
          <div className="mini-stats">
            <div>
              <div className="label">Clicks</div>
              <div className="value">
                {rest.current.clicks.toLocaleString("en-GB")}{" "}
                <ChangeBadge comparison={rest.comparison.clicks} />
              </div>
            </div>
            <div>
              <div className="label">Impressions</div>
              <div className="value">
                {rest.current.impressions.toLocaleString("en-GB")}{" "}
                <ChangeBadge comparison={rest.comparison.impressions} />
              </div>
            </div>
            <div>
              <div className="label">Click-through rate</div>
              <div className="value">{(rest.current.ctr * 100).toFixed(2)}%</div>
            </div>
          </div>
        </div>
        {metrics.contentGroups.length > 0 && (
          <div className="nested-box">
            <h3>Content group performance</h3>
            <Commentary section="content_groups" />
            <PerformanceBars groups={metrics.contentGroups} />
          </div>
        )}
        {metrics.topicClusters.length > 0 && (
          <div className="nested-box">
            <h3>Keyword group performance</h3>
            <p className="section-desc">
              Search demand by topic: groups of related queries from Search Console, current period vs
              comparison period.
            </p>
            <Commentary section="topic_clusters" />
            <PerformanceBars groups={metrics.topicClusters} />
          </div>
        )}
      </ReportSection>

      {/* 6. Visibility changes (rankings) */}
      <ReportSection
        title="Visibility changes (tracked rankings)"
        description="Tracked keyword positions, start vs end of the period."
      >
        <Commentary section="rankings" />
        <RankingsSection summary={metrics.rankings} engines={metrics.rankingEngines} />
      </ReportSection>

      {/* 7. Cannibalisation catcher */}
      <ReportSection
        title="Cannibalisation catcher"
        description="Queries where more than one page competes in the search results. Click ▸ to see the competing URLs."
      >
        <Commentary section="cannibalisation" />
        {mode === "team" ? (
          <>
            <p className="section-desc">
              Use the &ldquo;In report?&rdquo; toggle to curate what the client sees — hidden rows are
              dimmed here and left out of the published report.
            </p>
            <CannibalisationTable issues={metrics.cannibalisation} curation={{ clientKey }} />
          </>
        ) : (
          <CannibalisationTable issues={metrics.cannibalisation.filter((i) => !i.hidden)} />
        )}
      </ReportSection>

      {/* 8. Raw data / debug — team only */}
      {mode === "team" && (
        <details className="debug">
          <summary>Raw data &amp; debug (snapshot contents)</summary>
          <p className="section-desc">
            Everything below is stored in the JSON snapshot so this report is reproducible and never changes
            when APIs are re-queried.
          </p>
          <pre>
            {JSON.stringify(
              {
                generatedAt: snapshot.generatedAt,
                dataSource: snapshot.dataSource,
                published: snapshot.published ?? null,
                findings: snapshot.findings,
                siteTotals: snapshot.metrics.site,
                rawRowCounts: {
                  currentPages: snapshot.raw.gsc.current.pages.length,
                  currentQueries: snapshot.raw.gsc.current.queries.length,
                  currentQueryPages: snapshot.raw.gsc.current.queryPages.length,
                  rankingImports: snapshot.raw.rankingImports.length,
                },
                futurePlaceholders: snapshot.future,
              },
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </>
  );
}
