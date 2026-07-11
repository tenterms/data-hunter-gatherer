import fs from "fs";
import path from "path";
import { REPORTS_DIR } from "./config";
import type { ReportSnapshot } from "./types";

/** Filesystem access to generated report snapshots, used by the dashboard. */

export interface SnapshotListing {
  clientKey: string;
  clientName: string;
  periodKey: string;
  periodLabel: string;
  generatedAt: string;
  dataSource: "mock" | "live";
  totalClicks: number;
}

export function listSnapshots(): SnapshotListing[] {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  const listings: SnapshotListing[] = [];
  for (const clientKey of fs.readdirSync(REPORTS_DIR)) {
    const clientDir = path.join(REPORTS_DIR, clientKey);
    if (!fs.statSync(clientDir).isDirectory()) continue;
    for (const file of fs.readdirSync(clientDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const snapshot = JSON.parse(fs.readFileSync(path.join(clientDir, file), "utf8")) as ReportSnapshot;
        listings.push({
          clientKey: snapshot.client.client_key,
          clientName: snapshot.client.client_name,
          periodKey: snapshot.period.period_key,
          periodLabel: snapshot.period.label,
          generatedAt: snapshot.generatedAt,
          dataSource: snapshot.dataSource,
          totalClicks: snapshot.metrics.site.current.clicks,
        });
      } catch {
        // Skip unreadable snapshots rather than breaking the home page.
      }
    }
  }
  listings.sort((a, b) => a.clientName.localeCompare(b.clientName) || b.periodKey.localeCompare(a.periodKey));
  return listings;
}

export function readSnapshot(clientKey: string, periodKey: string): ReportSnapshot | null {
  // Guard against path traversal from URL segments.
  const safe = /^[a-z0-9_-]+$/i;
  if (!safe.test(clientKey) || !safe.test(periodKey)) return null;
  const file = path.join(REPORTS_DIR, clientKey, `${periodKey}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ReportSnapshot;
  } catch {
    return null;
  }
}
