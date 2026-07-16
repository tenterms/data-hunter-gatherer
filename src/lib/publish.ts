import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getAppConfig, REPORTS_DIR } from "./config";
import { readSnapshot } from "./snapshots";
import { recordGeneratedReport } from "./sheets";
import type { ReportSnapshot } from "./types";

/**
 * Publishing: freezing a draft report into a client-shareable copy.
 *
 * The team edits the draft (data/reports/{client}/{period}.json). Publishing
 * copies it to {period}.published.json with an unguessable token; the client
 * view (/share/{token}) serves ONLY published copies. Draft edits never leak
 * to the client until "Publish update" is clicked again. The token is stable
 * across republends so the client's link keeps working.
 */

function draftPath(clientKey: string, periodKey: string): string {
  return path.join(REPORTS_DIR, clientKey, `${periodKey}.json`);
}

function publishedPath(clientKey: string, periodKey: string): string {
  return path.join(REPORTS_DIR, clientKey, `${periodKey}.published.json`);
}

const SAFE = /^[a-z0-9_-]+$/i;

export function readPublished(clientKey: string, periodKey: string): ReportSnapshot | null {
  if (!SAFE.test(clientKey) || !SAFE.test(periodKey)) return null;
  const file = publishedPath(clientKey, periodKey);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ReportSnapshot;
  } catch {
    return null;
  }
}

export function findPublishedByToken(token: string): ReportSnapshot | null {
  if (!/^[a-f0-9]{24,64}$/i.test(token)) return null;
  if (!fs.existsSync(REPORTS_DIR)) return null;
  for (const clientKey of fs.readdirSync(REPORTS_DIR)) {
    const dir = path.join(REPORTS_DIR, clientKey);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".published.json")) continue;
      try {
        const snapshot = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as ReportSnapshot;
        if (snapshot.published?.token === token) return snapshot;
      } catch {
        // skip unreadable file
      }
    }
  }
  return null;
}

export interface PublishResult {
  ok: boolean;
  message: string;
  shareUrl?: string;
}

export async function publishReport(clientKey: string, periodKey: string): Promise<PublishResult> {
  const draft = readSnapshot(clientKey, periodKey);
  if (!draft) return { ok: false, message: "No report found — generate it first." };

  // Keep an existing token so the client's link survives republishing.
  const existing = readPublished(clientKey, periodKey);
  const token = existing?.published?.token ?? crypto.randomBytes(16).toString("hex");
  const published = { token, publishedAt: new Date().toISOString() };

  const frozen: ReportSnapshot = { ...draft, published };
  fs.writeFileSync(publishedPath(clientKey, periodKey), JSON.stringify(frozen, null, 2));

  // Mark the draft too so the team view shows publish state.
  const draftWithState: ReportSnapshot = { ...draft, published };
  fs.writeFileSync(draftPath(clientKey, periodKey), JSON.stringify(draftWithState, null, 2));

  const shareUrl = `${getAppConfig().appUrl}/share/${token}`;
  try {
    await recordGeneratedReport({
      client_key: clientKey,
      period_key: periodKey,
      generated_at: draft.generatedAt,
      snapshot_path: path.relative(process.cwd(), draftPath(clientKey, periodKey)),
      dashboard_url: shareUrl,
      status: "published",
    });
  } catch {
    // best effort
  }

  return {
    ok: true,
    message: existing ? "Published update — the client link now shows the latest version." : "Published.",
    shareUrl,
  };
}

export async function unpublishReport(clientKey: string, periodKey: string): Promise<PublishResult> {
  if (!SAFE.test(clientKey) || !SAFE.test(periodKey)) return { ok: false, message: "Invalid report." };
  const file = publishedPath(clientKey, periodKey);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const draft = readSnapshot(clientKey, periodKey);
  if (draft) {
    fs.writeFileSync(draftPath(clientKey, periodKey), JSON.stringify({ ...draft, published: null }, null, 2));
  }
  return { ok: true, message: "Unpublished — the client link no longer works." };
}
