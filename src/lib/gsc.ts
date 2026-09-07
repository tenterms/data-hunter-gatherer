import { google } from "googleapis";
import { getGscAuth } from "./googleAuth";
import type {
  AdminConfig,
  ClientRow,
  DateRange,
  GscDataset,
  GscRow,
} from "./types";
import { calcCtr } from "./metrics";

/**
 * Google Search Console adapter.
 *
 * LiveGscAdapter talks to the Search Analytics API with rowLimit/startRow
 * pagination. MockGscAdapter deterministically generates plausible data from
 * the client's configured pages and topic cluster rules, so the whole app is
 * demonstrable with zero credentials — and re-running a mock report produces
 * identical numbers.
 */

export interface GscAdapter {
  readonly source: "live" | "mock";
  fetchDataset(client: ClientRow, range: DateRange): Promise<GscDataset>;
}

// ---------------------------------------------------------------------------
// Live adapter
// ---------------------------------------------------------------------------

const ROW_LIMIT = 25000;

/** True when a fetch came back with no traffic rows at all. */
export function isEmptyDataset(data: GscDataset): boolean {
  return (
    data.pages.length === 0 &&
    data.queries.length === 0 &&
    data.queryPages.length === 0 &&
    (data.summary === null || (data.summary.clicks === 0 && data.summary.impressions === 0))
  );
}

export class LiveGscAdapter implements GscAdapter {
  readonly source = "live" as const;

  /** client_key -> property URL that actually worked, so retries only happen once */
  private siteUrlCache = new Map<string, string>();

  constructor(private log: (message: string) => void = () => {}) {}

  private api() {
    return google.searchconsole({ version: "v1", auth: getGscAuth() as never });
  }

  private async queryAll(siteUrl: string, range: DateRange, dimensions: string[]): Promise<GscRow[]> {
    const searchconsole = this.api();
    const rows: GscRow[] = [];
    let startRow = 0;
    for (;;) {
      const res = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions,
          rowLimit: ROW_LIMIT,
          startRow,
        },
      });
      const batch = res.data.rows ?? [];
      for (const r of batch) {
        rows.push({
          keys: r.keys ?? [],
          clicks: r.clicks ?? 0,
          impressions: r.impressions ?? 0,
          ctr: r.ctr ?? 0,
          position: r.position ?? 0,
        });
      }
      if (batch.length < ROW_LIMIT) break;
      startRow += ROW_LIMIT;
    }
    return rows;
  }

  private async fetchAll(siteUrl: string, range: DateRange): Promise<GscDataset> {
    const [summaryRows, pages, queries, queryPages] = await Promise.all([
      this.queryAll(siteUrl, range, []),
      this.queryAll(siteUrl, range, ["page"]),
      this.queryAll(siteUrl, range, ["query"]),
      this.queryAll(siteUrl, range, ["query", "page"]),
    ]);
    return { summary: summaryRows[0] ?? null, pages, queries, queryPages };
  }

  private findAccessibleProperty(client: ClientRow): Promise<string | null> {
    return findAccessibleProperty(client);
  }

  async fetchDataset(client: ClientRow, range: DateRange): Promise<GscDataset> {
    const cached = this.siteUrlCache.get(client.client_key);
    const configured = cached ?? client.gsc_property_url;
    try {
      const data = await this.fetchAll(configured, range);
      // A verified-but-wrong property (say the non-www variant of a www site)
      // answers successfully with zero rows, which used to render a report
      // full of zeros. Treat "no data at all" like a miss and look for the
      // property that actually holds the site's traffic.
      if (!cached && isEmptyDataset(data)) {
        const alternative = await this.findAccessibleProperty(client).catch(() => null);
        if (alternative && alternative !== configured) {
          const alt = await this.fetchAll(alternative, range).catch(() => null);
          if (alt && !isEmptyDataset(alt)) {
            this.log(
              `GSC: "${configured}" returned no data — using "${alternative}" instead (matched from the account's property list).`,
            );
            this.siteUrlCache.set(client.client_key, alternative);
            return alt;
          }
        }
      }
      this.siteUrlCache.set(client.client_key, configured);
      return data;
    } catch (error) {
      if (cached) throw error; // the resolved property itself failed — a real error
      const alternative = await this.findAccessibleProperty(client).catch(() => null);
      if (!alternative || alternative === configured) throw error;
      this.log(
        `GSC: no access to "${configured}" — using "${alternative}" instead (matched from the service account's property list).`,
      );
      const data = await this.fetchAll(alternative, range);
      this.siteUrlCache.set(client.client_key, alternative);
      return data;
    }
  }
}

/**
 * Ask Search Console which properties the service account can see and pick
 * the one matching the client's domain. Handles the common mismatch where
 * the client was set up as `sc-domain:example.com` but access was granted
 * on a URL-prefix property like `https://example.com/` (or vice versa,
 * and with/without www).
 */
export async function findAccessibleProperty(client: ClientRow): Promise<string | null> {
  const api = google.searchconsole({ version: "v1", auth: getGscAuth() as never });
  const res = await api.sites.list();
  const domain = client.domain.toLowerCase().replace(/^www\./, "");
  const matchesDomain = (siteUrl: string): boolean => {
    const s = siteUrl.toLowerCase();
    if (s.startsWith("sc-domain:")) return s.slice("sc-domain:".length) === domain;
    try {
      return new URL(s).hostname.replace(/^www\./, "") === domain;
    } catch {
      return false;
    }
  };
  const usable = (res.data.siteEntry ?? []).filter(
    (e) => e.siteUrl && e.permissionLevel !== "siteUnverifiedUser",
  );
  // Prefer a domain property when both kinds are available.
  const match =
    usable.find((e) => e.siteUrl!.startsWith("sc-domain:") && matchesDomain(e.siteUrl!)) ??
    usable.find((e) => matchesDomain(e.siteUrl!));
  return match?.siteUrl ?? null;
}

/**
 * Resolve the property URL the service account can actually query for this
 * client: the configured one if it works, else the best match from the
 * property list (shared by report generation and Reactimus).
 */
export async function resolveGscSiteUrl(client: ClientRow): Promise<string> {
  const api = google.searchconsole({ version: "v1", auth: getGscAuth() as never });
  const end = new Date();
  end.setDate(end.getDate() - 2);
  const start = new Date(end);
  start.setDate(start.getDate() - 28);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  try {
    await api.searchanalytics.query({
      siteUrl: client.gsc_property_url,
      requestBody: { startDate: fmt(start), endDate: fmt(end), rowLimit: 1 },
    });
    return client.gsc_property_url;
  } catch {
    const alternative = await findAccessibleProperty(client).catch(() => null);
    return alternative ?? client.gsc_property_url;
  }
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32) so mock data is stable run-to-run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(key: string): number {
  return mulberry32(hashString(key))();
}

function ctrForPosition(position: number, r: number): number {
  if (position <= 1.5) return 0.05 + r * 0.08;
  if (position <= 3) return 0.02 + r * 0.04;
  if (position <= 10) return 0.005 + r * 0.02;
  if (position <= 20) return 0.002 + r * 0.006;
  return r * 0.0015;
}

interface MockQueryAssignment {
  query: string;
  pages: Array<{ url: string; share: number; positionOffset: number }>;
  baseImpressions: number;
  basePosition: number;
  branded: boolean;
}

export class MockGscAdapter implements GscAdapter {
  readonly source = "mock" as const;

  constructor(private adminConfig: AdminConfig) {}

  private buildQueryUniverse(client: ClientRow): MockQueryAssignment[] {
    const cfg = this.adminConfig;
    const pages = cfg.clientPages.filter((p) => p.client_key === client.client_key && p.active);
    const homepage =
      pages.find((p) => p.page_role === "primary" && /https?:\/\/[^/]+\/?$/.test(p.url))?.url ??
      pages[0]?.url ??
      `https://${client.domain}/`;

    const ruleTexts = cfg.topicClusterRules
      .filter((r) => r.client_key === client.client_key && r.active && r.match_type !== "regex")
      .map((r) => r.query_text.toLowerCase());

    const uniqueTerms = [...new Set(ruleTexts)];
    const assignments: MockQueryAssignment[] = [];

    const pickPage = (term: string, salt: string): string => {
      // Prefer a page whose URL or label shares a word with the term.
      const words = term.split(/\s+/).filter((w) => w.length > 3);
      const candidates = pages.filter((p) =>
        words.some((w) => p.url.toLowerCase().includes(w) || p.label.toLowerCase().includes(w)),
      );
      if (candidates.length > 0) {
        return candidates[Math.floor(rand(term + salt) * candidates.length)].url;
      }
      return homepage;
    };

    const variants = (term: string): string[] => [
      term,
      `${term} services`,
      `${term} company`,
      `${term} uk`,
      `best ${term}`,
      `${term} agency`,
    ];

    for (const term of uniqueTerms) {
      for (const query of variants(term)) {
        const r = rand(`q:${client.client_key}:${query}`);
        const primaryUrl = pickPage(term, query);
        const qPages: MockQueryAssignment["pages"] = [{ url: primaryUrl, share: 1, positionOffset: 0 }];

        // ~22% of queries hit a second page, ~7% a third — the cannibalisation pool.
        const r2 = rand(`multi:${client.client_key}:${query}`);
        if (r2 < 0.22 && pages.length > 1) {
          const other = pages[Math.floor(rand(`other:${query}`) * pages.length)];
          if (other.url !== primaryUrl) {
            qPages[0].share = 0.65;
            qPages.push({ url: other.url, share: 0.35, positionOffset: 4 + Math.floor(r2 * 20) });
          }
          if (r2 < 0.07 && pages.length > 2 && qPages.length === 2) {
            const third = pages[Math.floor(rand(`third:${query}`) * pages.length)];
            if (!qPages.some((p) => p.url === third.url)) {
              qPages[0].share = 0.55;
              qPages[1].share = 0.3;
              qPages.push({ url: third.url, share: 0.15, positionOffset: 10 + Math.floor(r2 * 100) });
            }
          }
        }

        assignments.push({
          query,
          pages: qPages,
          baseImpressions: Math.round(20 + Math.pow(r, 2.2) * 4500),
          basePosition: 1 + Math.pow(rand(`pos:${query}:${client.client_key}`), 1.4) * 55,
          branded: false,
        });
      }
    }

    // Brand queries — high CTR, position 1.
    const brand = client.client_name.toLowerCase();
    assignments.push({
      query: brand,
      pages: [{ url: homepage, share: 1, positionOffset: 0 }],
      baseImpressions: Math.round(80 + rand(`brand:${client.client_key}`) * 200),
      basePosition: 1,
      branded: true,
    });

    // A few AI-assistant style long-tail queries, mirroring what turns up in
    // real GSC exports these days.
    const aiTerms = uniqueTerms.slice(0, 2);
    for (const term of aiTerms) {
      assignments.push({
        query: `i live in the united kingdom. what ${term} providers have the best reputation?`,
        pages: [
          { url: pickPage(term, "ai1"), share: 0.6, positionOffset: 0 },
          { url: homepage, share: 0.4, positionOffset: 2 },
        ],
        baseImpressions: Math.round(60 + rand(`ai:${term}`) * 140),
        basePosition: 1 + rand(`aipos:${term}`) * 5,
        branded: false,
      });
    }

    return assignments;
  }

  async fetchDataset(client: ClientRow, range: DateRange): Promise<GscDataset> {
    const assignments = this.buildQueryUniverse(client);
    const periodKey = `${range.startDate}:${range.endDate}`;
    const queryPages: GscRow[] = [];

    for (const a of assignments) {
      // Each query gets a signed trend whose direction alternates with the
      // month, so any pair of adjacent months shows a believable mix of
      // growing and decaying queries; small per-period noise on top.
      const trend = (rand(`trend:${client.client_key}:${a.query}`) - 0.5) * 0.8;
      const monthSign = Number(range.startDate.slice(5, 7)) % 2 === 0 ? 1 : -1;
      const noise = 0.95 + rand(`pf:${client.client_key}:${a.query}:${periodKey}`) * 0.1;
      const pf = Math.max(0.15, (1 + monthSign * trend) * noise);
      const impressionsTotal = Math.max(0, Math.round(a.baseImpressions * pf));
      if (impressionsTotal === 0) continue;

      for (const p of a.pages) {
        const impressions = Math.round(impressionsTotal * p.share);
        if (impressions === 0) continue;
        const drift = (rand(`drift:${a.query}:${p.url}:${periodKey}`) - 0.5) * 5;
        const position = Math.max(1, a.basePosition + p.positionOffset + drift);
        // CTR character is a property of the query/page pair, not the month —
        // month-on-month click change then follows the impression trend.
        const ctr = a.branded
          ? 0.3 + rand(`bctr:${client.client_key}:${a.query}`) * 0.2
          : ctrForPosition(position, rand(`ctr:${a.query}:${p.url}`));
        const clicks = Math.round(impressions * ctr);
        queryPages.push({
          keys: [a.query, p.url],
          clicks,
          impressions,
          ctr: calcCtr(clicks, impressions),
          position: Math.round(position * 10) / 10,
        });
      }
    }

    // Roll query+page rows up into consistent query-level and page-level sets.
    const rollup = (index: 0 | 1): GscRow[] => {
      const map = new Map<string, { clicks: number; impressions: number; posW: number }>();
      for (const row of queryPages) {
        const key = row.keys[index];
        const agg = map.get(key) ?? { clicks: 0, impressions: 0, posW: 0 };
        agg.clicks += row.clicks;
        agg.impressions += row.impressions;
        agg.posW += row.position * row.impressions;
        map.set(key, agg);
      }
      return [...map.entries()]
        .map(([key, agg]) => ({
          keys: [key],
          clicks: agg.clicks,
          impressions: agg.impressions,
          ctr: calcCtr(agg.clicks, agg.impressions),
          position: agg.impressions > 0 ? Math.round((agg.posW / agg.impressions) * 10) / 10 : 0,
        }))
        .sort((a, b) => b.impressions - a.impressions);
    };

    const queries = rollup(0);
    const pages = rollup(1);

    const totalClicks = pages.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = pages.reduce((s, r) => s + r.impressions, 0);
    const posW = pages.reduce((s, r) => s + r.position * r.impressions, 0);
    const summary: GscRow = {
      keys: [],
      clicks: totalClicks,
      impressions: totalImpressions,
      ctr: calcCtr(totalClicks, totalImpressions),
      position: totalImpressions > 0 ? Math.round((posW / totalImpressions) * 10) / 10 : 0,
    };

    return { summary, pages, queries, queryPages };
  }
}
