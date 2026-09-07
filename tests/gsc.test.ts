import { describe, expect, it } from "vitest";
import { isEmptyDataset } from "../src/lib/gsc";
import type { GscDataset, GscRow } from "../src/lib/types";

const row = (clicks: number, impressions: number): GscRow => ({
  keys: [],
  clicks,
  impressions,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position: 0,
});

const empty: GscDataset = { summary: null, pages: [], queries: [], queryPages: [] };

describe("isEmptyDataset", () => {
  it("treats a fetch with no rows as empty", () => {
    expect(isEmptyDataset(empty)).toBe(true);
  });

  it("treats a zeroed summary with no rows as empty", () => {
    expect(isEmptyDataset({ ...empty, summary: row(0, 0) })).toBe(true);
  });

  it("is not empty when the summary carries traffic", () => {
    expect(isEmptyDataset({ ...empty, summary: row(12, 300) })).toBe(false);
  });

  it("is not empty when page rows exist", () => {
    expect(isEmptyDataset({ ...empty, pages: [{ ...row(1, 10), keys: ["https://example.test/"] }] })).toBe(false);
  });
});
