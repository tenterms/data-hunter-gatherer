import { describe, expect, it } from "vitest";
import { classifyMovement, movementFromImportRow, summariseRankings } from "../src/lib/rankings";
import type { RankingImportRow, RankingMovement } from "../src/lib/types";

const row = (keyword: string, start: number | null, end: number | null): RankingImportRow => ({
  client_key: "c",
  period_key: "p",
  keyword,
  start_position: start,
  end_position: end,
  search_engine: "google.co.uk",
  location: "UK",
  device: "desktop",
  target_url: "",
  search_volume: null,
  ranking_url: "",
  visibility_score: null,
});

describe("movement classification", () => {
  it("up when position number falls", () => {
    expect(classifyMovement(12, 1)).toEqual({ change: 11, direction: "up" });
  });
  it("down when position number rises", () => {
    expect(classifyMovement(3, 38)).toEqual({ change: -35, direction: "down" });
  });
  it("flat when unchanged", () => {
    expect(classifyMovement(15, 15)).toEqual({ change: 0, direction: "flat" });
  });
  it("entered when there is no start position", () => {
    expect(classifyMovement(null, 7).direction).toBe("entered");
  });
  it("dropped when there is no end position", () => {
    expect(classifyMovement(42, null).direction).toBe("dropped");
  });
});

describe("summariseRankings", () => {
  const movements: RankingMovement[] = [
    movementFromImportRow(row("gain big", 12, 1)),
    movementFromImportRow(row("gain small", 8, 6)),
    movementFromImportRow(row("decline big", 3, 38)),
    movementFromImportRow(row("decline small", 10, 12)),
    movementFromImportRow(row("flat", 15, 15)),
    movementFromImportRow(row("new entry", null, 7)),
    movementFromImportRow(row("gone", 42, null)),
  ];
  const summary = summariseRankings(movements, "csv_import", 6);

  it("counts ups/downs/entered/dropped", () => {
    expect(summary.positionsUp).toBe(2);
    expect(summary.positionsDown).toBe(2);
    expect(summary.entered).toBe(1);
    expect(summary.dropped).toBe(1);
    expect(summary.keywordsTracked).toBe(7);
  });

  it("computes top 3/10/30 for both ends of the period", () => {
    // end positions: 1,6,38,12,15,7 -> top3: 1; top10: 3; top30: 5
    expect(summary.top3).toEqual({ current: 1, previous: 1 }); // start: 3 was top3
    expect(summary.top10).toEqual({ current: 3, previous: 3 });
    // start positions: 12,8,3,10,15,42 -> five are ≤30
    expect(summary.top30).toEqual({ current: 5, previous: 5 });
  });

  it("ranks notable gains and declines sensibly", () => {
    expect(summary.notableGains[0].keyword).toBe("new entry"); // entered at position 7
    expect(summary.notableGains.map((m) => m.keyword)).toContain("gain big");
    expect(summary.notableDeclines[0].keyword).toBe("gone"); // dropped out entirely
    expect(summary.notableDeclines.map((m) => m.keyword)).toContain("decline big");
  });

  it("carries the visibility score through when available", () => {
    expect(summary.visibilityScore).toBe(6);
    expect(summariseRankings(movements, "csv_import").visibilityScore).toBeNull();
  });

  it("handles an empty movement set without NaN", () => {
    const empty = summariseRankings([], "unavailable");
    expect(empty.averagePosition.current).toBeNull();
    expect(empty.keywordsTracked).toBe(0);
  });
});

describe("dedupeMovements", () => {
  it("keeps the first engine's entry for a repeated keyword", async () => {
    const { dedupeMovements } = await import("../src/lib/rankings");
    const engines = [
      {
        id: "1",
        label: "Google UK",
        movements: [movementFromImportRow(row("shared", 5, 3)), movementFromImportRow(row("only uk", 9, 9))],
      },
      {
        id: "2",
        label: "Google US",
        movements: [movementFromImportRow(row("shared", 40, 50)), movementFromImportRow(row("only us", 2, 2))],
      },
    ];
    const combined = dedupeMovements(engines);
    expect(combined.map((m) => m.keyword).sort()).toEqual(["only uk", "only us", "shared"]);
    expect(combined.find((m) => m.keyword === "shared")?.endPosition).toBe(3);
  });
});
