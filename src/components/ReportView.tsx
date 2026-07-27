import type { CommentarySection, ReportSnapshot } from "@/lib/types";
import KpiCard from "@/components/KpiCard";
import ReportSection from "@/components/ReportSection";
import CommentaryBlock from "@/components/CommentaryBlock";
import EditableCommentary from "@/components/EditableCommentary";
import PerformanceBars from "@/components/PerformanceBars";
import PagesTable from "@/components/PagesTable";
import CannibalisationTable from "@/components/CannibalisationTable";
import RankingsSection from "@/components/RankingsSection";
import KeywordClustersTable from "@/components/KeywordClustersTable";
import DrawGrid from "@/components/DrawGrid";
import ChangeBadge from "@/components/ChangeBadge";

/**
 * The report itself, shared by two routes:
 *  - team mode: editable commentary, raw-data panel, internal badges
 *  - client mode: read-only, clean, no internals
 *
 * Section order (agreed with the team): executive summary → KPI cards →
 * work grid → traffic (GSC) → visibility (rankings) → topical by keyword →
 * topical by query → cannibalisation → strategic priorities.
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
        description="Design/Development · Reactive SEO · Anything else · Writing"
      >
        <DrawGrid tasks={snapshot.drawTasks} />
      </ReportSection>

      {/* 4. Traffic changes (GSC) */}
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
        <h3>Rest of site</h3>
        <p className="section-desc">
          Everything not tracked as a key page ({rest.pageCount} URLs):{" "}
          {rest.current.clicks.toLocaleString("en-GB")} clicks{" "}
          <ChangeBadge comparison={rest.comparison.clicks} />,{" "}
          {rest.current.impressions.toLocaleString("en-GB")} impressions{" "}
          <ChangeBadge comparison={rest.comparison.impressions} />.
        </p>
        {metrics.contentGroups.length > 0 && (
          <>
            <h3>Content group performance</h3>
            <Commentary section="content_groups" />
            <PerformanceBars groups={metrics.contentGroups} />
          </>
        )}
      </ReportSection>

      {/* 5. Visibility changes (rankings) */}
      <ReportSection
        title="Visibility changes (tracked rankings)"
        description="Tracked keyword positions, start vs end of the period."
      >
        <Commentary section="rankings" />
        <RankingsSection summary={metrics.rankings} />
      </ReportSection>

      {/* 6. Topical performance (by keyword) */}
      <ReportSection
        title="Topical performance (by keyword)"
        description="Tracked-keyword ranking movements grouped by topic cluster."
      >
        <KeywordClustersTable clusters={metrics.keywordClusters ?? []} />
      </ReportSection>

      {/* 7. Topical performance (by query) */}
      <ReportSection
        title="Topical performance (by query)"
        description="Search demand by topic: groups of related queries from Search Console, current period vs comparison period."
      >
        <Commentary section="topic_clusters" />
        <PerformanceBars groups={metrics.topicClusters} />
      </ReportSection>

      {/* 8. Cannibalisation catcher */}
      <ReportSection
        title="Cannibalisation catcher"
        description="Queries where more than one page competes in the search results. Click ▸ to see the competing URLs."
      >
        <Commentary section="cannibalisation" />
        <CannibalisationTable issues={metrics.cannibalisation} />
      </ReportSection>

      {/* 9. Strategic priorities */}
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

      {/* 10. Raw data / debug — team only */}
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
