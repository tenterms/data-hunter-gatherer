import { describe, expect, it } from "vitest";
import { findCannibalisation, scoreCannibalisation } from "../src/lib/cannibalisation";
import type { ClientPageRow, GscRow } from "../src/lib/types";

const qp = (query: string, url: string, clicks: number, impressions: number, position: number): GscRow => ({
  keys: [query, url],
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

const pages: ClientPageRow[] = [
  {
    client_key: "c",
    url: "https://x.com/services/a",
    label: "A",
    page_role: "primary",
    content_type: "commercial",
    commercial_priority: "high",
    active: true,
    notes: "",
  },
  {
    client_key: "c",
    url: "https://x.com/blog/b",
    label: "B",
    page_role: "supporting",
    content_type: "blog",
    commercial_priority: "low",
    active: true,
    notes: "",
  },
];

describe("findCannibalisation", () => {
  it("only keeps queries where more than one URL receives impressions", () => {
    const rows = [
      qp("solo query", "https://x.com/services/a", 5, 100, 3),
      qp("shared query", "https://x.com/services/a", 1, 300, 5),
      qp("shared query", "https://x.com/blog/b", 0, 200, 12),
    ];
    const issues = findCannibalisation(rows, pages);
    expect(issues).toHaveLength(1);
    expect(issues[0].query).toBe("shared query");
    expect(issues[0].pageCount).toBe(2);
  });

  it("aggregates totals and includes the page breakdown with roles", () => {
    const rows = [
      qp("q", "https://x.com/services/a", 2, 400, 4),
      qp("q", "https://x.com/blog/b", 1, 100, 15),
    ];
    const [issue] = findCannibalisation(rows, pages);
    expect(issue.clicks).toBe(3);
    expect(issue.impressions).toBe(500);
    expect(issue.ctr).toBeCloseTo(3 / 500);
    expect(issue.position).toBeCloseTo((4 * 400 + 15 * 100) / 500);
    expect(issue.pages[0].pageRole).toBe("primary");
    expect(issue.pages[1].commercialPriority).toBe("low");
  });

  it("prioritises high-impression, low-CTR, good-position, commercial-page issues", () => {
    const bad = scoreCannibalisation({
      impressions: 5000,
      clicks: 2,
      ctr: 2 / 5000,
      position: 6,
      pageCount: 3,
      importantPageCount: 2,
    });
    const mild = scoreCannibalisation({
      impressions: 60,
      clicks: 5,
      ctr: 5 / 60,
      position: 30,
      pageCount: 2,
      importantPageCount: 0,
    });
    expect(bad).toBeGreaterThan(mild);
  });

  it("sorts issues by priority score, worst first", () => {
    const rows = [
      qp("big problem", "https://x.com/services/a", 0, 4000, 5),
      qp("big problem", "https://x.com/blog/b", 0, 2000, 9),
      qp("small overlap", "https://x.com/services/a", 3, 40, 22),
      qp("small overlap", "https://x.com/blog/b", 1, 30, 35),
    ];
    const issues = findCannibalisation(rows, pages);
    expect(issues[0].query).toBe("big problem");
    expect(issues[0].priorityScore).toBeGreaterThan(issues[1].priorityScore);
    expect(issues[0].priorityFlag).toBe("high");
  });

  it("respects the minimum impressions filter", () => {
    const rows = [
      qp("noise", "https://x.com/services/a", 0, 2, 5),
      qp("noise", "https://x.com/blog/b", 0, 3, 9),
    ];
    expect(findCannibalisation(rows, pages, { minImpressionsPerPage: 5 })).toHaveLength(0);
  });
});
