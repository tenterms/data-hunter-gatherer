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
      <ReportSection
        title="Executive summary"
        description="The month in a nutshell — what happened, why it matters, and what we're focused on next."
      >
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
        description="What we're doing for you right now, and what we finished last month — across design, SEO fixes, content and everything else."
      >
        <DrawGrid
          tasks={snapshot.drawTasks}
          editable={mode === "team" ? { clientKey, periodKey } : undefined}
        />
      </ReportSection>

      {/* 4. Strategic priorities */}
      <ReportSection
        title="Strategic priorities"
        description="The moves we recommend next, and why each one is worth doing."
      >
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
        description="How often the site showed up in Google searches, and how many people clicked through — for the pages that matter most, compared with the month before."
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
            <p className="section-desc">
              The site&apos;s pages bundled into groups (like &ldquo;service pages&rdquo; or
              &ldquo;blog posts&rdquo;), so you can see at a glance which parts of the site are
              gaining or losing search traffic.
            </p>
            <Commentary section="content_groups" />
            <PerformanceBars groups={metrics.contentGroups} />
          </div>
        )}
        {metrics.topicClusters.length > 0 && (
          <div className="nested-box">
            <h3>Keyword group performance</h3>
            <p className="section-desc">
              How the site performed in searches about each topic below — for example, every search
              containing that phrase. A quick read on which subjects are growing and which are
              slipping.
            </p>
            <Commentary section="topic_clusters" />
            <PerformanceBars groups={metrics.topicClusters} />
          </div>
        )}
      </ReportSection>

      {/* 6. Visibility changes (rankings) */}
      <ReportSection
        title="Visibility changes (tracked rankings)"
        description="Where the site ranks in Google for the keywords we track on purpose. Position 1 is the top result; anything up to 10 is on page one."
      >
        <Commentary section="rankings" />
        <RankingsSection summary={metrics.rankings} engines={metrics.rankingEngines} />
      </ReportSection>

      {/* 7. Cannibalisation catcher */}
      <ReportSection
        title="Cannibalisation catcher"
        description="Searches where two or more of the site's pages are competing with each other for the same spot in Google. Fixing these usually means one strong page instead of two weaker ones. Click ▸ to see the competing pages."
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
