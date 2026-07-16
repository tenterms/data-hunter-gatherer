import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findPublishedByToken } from "@/lib/publish";
import ReportView from "@/components/ReportView";

export const dynamic = "force-dynamic";

// Client share links must never end up in search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snapshot = findPublishedByToken(token);
  if (!snapshot) notFound();

  return (
    <main className="container share-view">
      <header className="share-header">
        <h1>
          {snapshot.client.client_name} — {snapshot.period.label}
        </h1>
        <p className="subtitle">
          Monthly SEO report · {snapshot.period.start_date} to {snapshot.period.end_date}, compared with the
          previous month{snapshot.dataSource === "mock" && <span className="badge mock"> demo data</span>}
        </p>
      </header>
      <ReportView snapshot={snapshot} mode="client" />
      <footer className="share-footer">
        Prepared with data from Google Search Console
        {snapshot.metrics.rankings.source !== "unavailable" && " and tracked keyword rankings"} · published{" "}
        {snapshot.published ? new Date(snapshot.published.publishedAt).toLocaleDateString("en-GB") : ""}
      </footer>
    </main>
  );
}
