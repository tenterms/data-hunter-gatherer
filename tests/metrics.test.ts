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
