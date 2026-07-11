import Link from "next/link";
import { notFound } from "next/navigation";
import { readSnapshot } from "@/lib/snapshots";
import type { CommentarySection, ReportSnapshot } from "@/lib/types";
import KpiCard from "@/components/KpiCard";
import ReportSection from "@/components/ReportSection";
import CommentaryBlock from "@/components/CommentaryBlock";
import PerformanceBars from "@/components/PerformanceBars";
import PagesTable from "@/components/PagesTable";
import CannibalisationTable from "@/components/CannibalisationTable";
import RankingsSection from "@/components/RankingsSection";
import DrawGrid from "@/components/DrawGrid";
import ChangeBadge from "@/components/ChangeBadge";

export const dynamic = "force-dynamic";

function commentaryFor(snapshot: ReportSnapshot, section: CommentarySection) {
  return snapshot.commentary.find((c) => c.section === section);
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ clientKey: string; periodKey: string }>;
}) {
  const { clientKey, periodKey } = await params;
  const snapshot = readSnapshot(clientKey, periodKey);
  if (!snapshot) notFound();

  const { metrics } = snapshot;
  const primaryPages = metrics.pages.filter((p) => p.pageRole === "primary");
  const secondaryPages = metrics.pages.filter((p) => p.pageRole === "secondary");
  const supportingPages = metrics.pages.filter((p) => p.pageRole === "supporting");
  const rest = metrics.restOfSite;

  return (
    <>
      <p style={{ margin: "0 0 4px" }}>
        <Link href="/">← All reports</Link>
      </p>
      <h1>
        {snapshot.client.client_name} — {snapshot.period.label}
      </h1>
      <p className="subtitle">
        {snapshot.period.start_date} to {snapshot.period.end_date} (compared with{" "}
        {snapshot.period.comparison_start_date} to {snapshot.period.comparison_end_date}){" "}
        <span className={`badge ${snapshot.dataSource}`}>{snapshot.dataSource} data</span>{" "}
        <span className="badge">generated {new Date(snapshot.generatedAt).toLocaleString("en-GB")}</span>
      </p>

      {/* 1. Executive summary */}
      <div className="kpi-grid">
        {snapshot.kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>
      <ReportSection title="Executive summary">
        <CommentaryBlock commentary={commentaryFor(snapshot, "executive_summary")} />
      </ReportSection>

      {/* 2. Traffic performance */}
      <ReportSection
        title="Traffic performance (Google Search Console)"
        description="Clicks, impressions, CTR and average position for the pages we actively work on, current period vs comparison period."
      >
        <CommentaryBlock commentary={commentaryFor(snapshot, "traffic")} />
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
          Everything not configured as a key page ({rest.pageCount} URLs):{" "}
          {rest.current.clicks.toLocaleString("en-GB")} clicks{" "}
          <ChangeBadge comparison={rest.comparison.clicks} />,{" "}
          {rest.current.impressions.toLocaleString("en-GB")} impressions{" "}
          <ChangeBadge comparison={rest.comparison.impressions} />.
        </p>
      </ReportSection>

      {/* 3. Content groups */}
      <ReportSection
        title="Content groups"
        description="Named URL groups configured in the ContentGroups sheet, aggregating page-level GSC data."
      >
        <CommentaryBlock commentary={commentaryFor(snapshot, "content_groups")} />
        <PerformanceBars groups={metrics.contentGroups} />
      </ReportSection>

      {/* 4. Topic clusters */}
      <ReportSection
        title="Topic clusters"
        description="Named query groups configured in the TopicClusters sheet, aggregating query-level GSC data. A query may count towards more than one cluster."
      >
        <CommentaryBlock commentary={commentaryFor(snapshot, "topic_clusters")} />
        <PerformanceBars groups={metrics.topicClusters} />
      </ReportSection>

      {/* 5. Cannibalisation catcher */}
      <ReportSection
        title="Cannibalisation catcher"
        description="Queries where more than one URL receives impressions. Priority rises with high impressions, weak CTR, more competing pages, strong-but-wasted positions, and primary/commercial pages being involved. Click ▸ to see the competing URLs."
      >
        <CommentaryBlock commentary={commentaryFor(snapshot, "cannibalisation")} />
        <CannibalisationTable issues={metrics.cannibalisation} />
      </ReportSection>

      {/* 6. Rankings / visibility */}
      <ReportSection
        title="Visibility &amp; rankings"
        description="Tracked keyword positions (SE Ranking or CSV/sheet import), start vs end of the period."
      >
        <CommentaryBlock commentary={commentaryFor(snapshot, "rankings")} />
        <RankingsSection summary={metrics.rankings} />
      </ReportSection>

      {/* 7. DRAW tasks */}
      <ReportSection
        title="DRAW: work completed &amp; planned"
        description="Design/Development · Reactive SEO · Anything else · Writing — from the DrawTasks sheet."
      >
        <DrawGrid tasks={snapshot.drawTasks} />
      </ReportSection>

      {/* 8. Strategic priorities */}
      <ReportSection
        title="Strategic priorities"
        description="Data-suggested priorities, overridable via the NarrativeOverrides sheet; plus manual notes from StrategicNotes."
      >
        <CommentaryBlock commentary={commentaryFor(snapshot, "strategic_priorities")} />
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

      {/* 9. Raw data / debug */}
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
    </>
  );
}
