import { describe, expect, it } from "vitest";
import {
  aggregateRows,
  calcCtr,
  classifyGrowth,
  compareMetricSets,
  compareValues,
  formatChangePct,
  safeDivide,
  weightedAveragePosition,
} from "../src/lib/metrics";
import type { GscRow } from "../src/lib/types";

describe("CTR calculation", () => {
  it("divides clicks by impressions", () => {
    expect(calcCtr(5, 100)).toBeCloseTo(0.05);
  });
  it("never divides by zero", () => {
    expect(calcCtr(5, 0)).toBe(0);
    expect(safeDivide(1, 0)).toBe(0);
    expect(safeDivide(0, 0)).toBe(0);
  });
});

describe("weighted average position", () => {
  it("weights by impressions", () => {
    // (2*100 + 10*300) / 400 = 8
    const result = weightedAveragePosition([
      { position: 2, impressions: 100 },
      { position: 10, impressions: 300 },
    ]);
    expect(result).toBeCloseTo(8);
  });
  it("returns null with no impressions instead of NaN", () => {
    expect(weightedAveragePosition([])).toBeNull();
    expect(weightedAveragePosition([{ position: 5, impressions: 0 }])).toBeNull();
  });
});

describe("aggregateRows", () => {
  const rows: GscRow[] = [
    { keys: ["a"], clicks: 10, impressions: 200, ctr: 0.05, position: 4 },
    { keys: ["b"], clicks: 0, impressions: 800, ctr: 0, position: 20 },
  ];
  it("sums clicks/impressions and recalculates ctr/position", () => {
    const agg = aggregateRows(rows);
    expect(agg.clicks).toBe(10);
    expect(agg.impressions).toBe(1000);
    expect(agg.ctr).toBeCloseTo(0.01);
    expect(agg.position).toBeCloseTo((4 * 200 + 20 * 800) / 1000);
  });
});

describe("comparison percentage-change rules", () => {
  it("0 -> 0 is 0% change, not NaN", () => {
    const c = compareValues(0, 0);
    expect(c.changePct).toBe(0);
    expect(c.isNew).toBe(false);
  });
  it("0 -> positive is null (new), never Infinity", () => {
    const c = compareValues(50, 0);
    expect(c.changePct).toBeNull();
    expect(c.isNew).toBe(true);
    expect(JSON.stringify(c)).not.toContain("Infinity");
  });
  it("normal change computes a fraction", () => {
    const c = compareValues(120, 100);
    expect(c.changePct).toBeCloseTo(0.2);
    expect(c.change).toBe(20);
  });
  it("formats sensibly", () => {
    expect(formatChangePct(compareValues(120, 100))).toBe("+20.0%");
    expect(formatChangePct(compareValues(80, 100))).toBe("-20.0%");
    expect(formatChangePct(compareValues(5, 0))).toBe("new");
  });
});

describe("growth classification", () => {
  const metrics = (clicks: number, impressions = 1000) => ({
    clicks,
    impressions,
    ctr: calcCtr(clicks, impressions),
    position: 10,
  });
  it("flags growth above the band", () => {
    const cmp = compareMetricSets(metrics(120), metrics(100));
    expect(classifyGrowth(cmp, "clicks")).toBe("growing");
  });
  it("flags decay below the band", () => {
    const cmp = compareMetricSets(metrics(50), metrics(100));
    expect(classifyGrowth(cmp, "clicks")).toBe("decaying");
  });
  it("treats tiny absolute movement as flat", () => {
    const cmp = compareMetricSets(metrics(2), metrics(1));
    expect(classifyGrowth(cmp, "clicks")).toBe("flat");
  });
  it("treats new (0 -> n) as growing", () => {
    const cmp = compareMetricSets(metrics(10), metrics(0));
    expect(classifyGrowth(cmp, "clicks")).toBe("growing");
  });
  it("supports impressions as the growth metric", () => {
    const cmp = compareMetricSets(metrics(10, 5000), metrics(10, 2000));
    expect(classifyGrowth(cmp, "impressions")).toBe("growing");
    expect(classifyGrowth(cmp, "clicks")).toBe("flat");
  });
});

describe("normaliseUrl", () => {
  it("matches across protocol, www and trailing-slash variants", async () => {
    const { normaliseUrl } = await import("../src/lib/metrics");
    const canonical = normaliseUrl("https://www.knightsbridgecircle.com/locations/london-concierge-service/");
    expect(normaliseUrl("https://knightsbridgecircle.com/locations/london-concierge-service")).toBe(canonical);
    expect(normaliseUrl("http://KnightsbridgeCircle.com/locations/london-concierge-service/")).toBe(canonical);
    expect(canonical).toBe("knightsbridgecircle.com/locations/london-concierge-service");
  });
});

describe("excludeUrlsFromDataset", () => {
  const page = (url: string, clicks: number, impressions: number, position = 5): GscRowT => ({
    keys: [url],
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position,
  });
  const qp = (query: string, url: string, clicks: number, impressions: number): GscRowT => ({
    keys: [query, url],
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: 5,
  });
  type GscRowT = import("../src/lib/types").GscRow;

  const dataset: import("../src/lib/types").GscDataset = {
    summary: { keys: [], clicks: 110, impressions: 1100, ctr: 0.1, position: 12 },
    pages: [
      page("https://aag-it.com/it-support/", 10, 100, 3),
      page("https://aag-it.com/cyber-attack-statistics/", 100, 1000, 20),
    ],
    queries: [
      { keys: ["it support"], clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
      { keys: ["how many cyber attacks per day"], clicks: 100, impressions: 1000, ctr: 0.1, position: 20 },
      { keys: ["it support statistics"], clicks: 6, impressions: 60, ctr: 0.1, position: 8 },
    ],
    queryPages: [
      qp("it support", "https://aag-it.com/it-support/", 10, 100),
      qp("how many cyber attacks per day", "https://aag-it.com/cyber-attack-statistics/", 100, 1000),
      qp("it support statistics", "https://aag-it.com/cyber-attack-statistics/", 4, 40),
      qp("it support statistics", "https://aag-it.com/it-support/", 2, 20),
    ],
  };

  it("drops matching pages and their query+page rows", async () => {
    const { excludeUrlsFromDataset } = await import("../src/lib/metrics");
    const out = excludeUrlsFromDataset(dataset, ["statistics"]);
    expect(out.pages.map((r) => r.keys[0])).toEqual(["https://aag-it.com/it-support/"]);
    expect(out.queryPages).toHaveLength(2);
  });

  it("subtracts only the excluded pages' share from each query", async () => {
    const { excludeUrlsFromDataset } = await import("../src/lib/metrics");
    const out = excludeUrlsFromDataset(dataset, ["statistics"]);
    const mixed = out.queries.find((r) => r.keys[0] === "it support statistics");
    expect(mixed).toMatchObject({ clicks: 2, impressions: 20 });
    expect(out.queries.some((r) => r.keys[0] === "how many cyber attacks per day")).toBe(false);
  });

  it("reduces the summary by the excluded totals and recomputes position", async () => {
    const { excludeUrlsFromDataset } = await import("../src/lib/metrics");
    const out = excludeUrlsFromDataset(dataset, ["statistics"]);
    expect(out.summary).toMatchObject({ clicks: 10, impressions: 100, position: 3 });
  });

  it("returns the dataset untouched when no patterns are set", async () => {
    const { excludeUrlsFromDataset } = await import("../src/lib/metrics");
    expect(excludeUrlsFromDataset(dataset, [" ", ""])).toBe(dataset);
  });
});
