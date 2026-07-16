import { describe, expect, it } from "vitest";
import { calculateContentGroups, groupMatchesUrl, urlMatches } from "../src/lib/contentGroups";
import type { ContentGroupRow, ContentGroupUrlRow, GscRow } from "../src/lib/types";

const page = (url: string, clicks: number, impressions: number, position = 10): GscRow => ({
  keys: [url],
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

describe("urlMatches", () => {
  it("exact match ignores trailing slashes and case", () => {
    expect(urlMatches("https://x.com/services/", "https://X.com/services", "exact")).toBe(true);
    expect(urlMatches("https://x.com/services/a", "https://x.com/services", "exact")).toBe(false);
  });
  it("contains matches substrings", () => {
    expect(urlMatches("https://x.com/services/prototyping", "prototyp", "contains")).toBe(true);
    expect(urlMatches("https://x.com/blog", "prototyp", "contains")).toBe(false);
  });
  it("starts_with matches prefixes", () => {
    expect(urlMatches("https://x.com/blog/post-1", "https://x.com/blog/", "starts_with")).toBe(true);
    expect(urlMatches("https://x.com/services", "https://x.com/blog/", "starts_with")).toBe(false);
  });
});

describe("groupMatchesUrl (contains / doesn't contain)", () => {
  const rule = (match_type: "contains" | "not_contains" | "starts_with", url: string) => ({
    client_key: "c",
    group_key: "g",
    url,
    match_type,
    active: true,
  });

  it("matches any include and respects exclusions", () => {
    const rules = [rule("contains", "/services/"), rule("not_contains", "archive")];
    expect(groupMatchesUrl("https://x.com/services/design", rules)).toBe(true);
    expect(groupMatchesUrl("https://x.com/services/archive/old", rules)).toBe(false);
    expect(groupMatchesUrl("https://x.com/blog/post", rules)).toBe(false);
  });

  it("mixes starts_with includes with exclusions", () => {
    const rules = [rule("starts_with", "https://x.com/blog/"), rule("not_contains", "draft")];
    expect(groupMatchesUrl("https://x.com/blog/a", rules)).toBe(true);
    expect(groupMatchesUrl("https://x.com/blog/draft-post", rules)).toBe(false);
  });

  it("never matches with only exclusions", () => {
    expect(groupMatchesUrl("https://x.com/a", [rule("not_contains", "b")])).toBe(false);
  });
});

describe("calculateContentGroups", () => {
  const groups: ContentGroupRow[] = [
    { client_key: "c", group_key: "blog", group_name: "Blog", description: "", active: true },
    { client_key: "c", group_key: "inactive", group_name: "Off", description: "", active: false },
  ];
  const rules: ContentGroupUrlRow[] = [
    { client_key: "c", group_key: "blog", url: "https://x.com/blog/", match_type: "starts_with", active: true },
    { client_key: "c", group_key: "inactive", url: "https://x.com/", match_type: "starts_with", active: true },
  ];
  const current = [page("https://x.com/blog/a", 30, 500), page("https://x.com/blog/b", 20, 300), page("https://x.com/other", 99, 999)];
  const previous = [page("https://x.com/blog/a", 10, 400), page("https://x.com/blog/b", 15, 350)];

  it("aggregates matched pages for both periods with changes and status", () => {
    const result = calculateContentGroups(groups, rules, current, previous);
    expect(result).toHaveLength(1); // inactive group excluded
    const blog = result[0];
    expect(blog.current.clicks).toBe(50);
    expect(blog.previous.clicks).toBe(25);
    expect(blog.comparison.clicks.changePct).toBeCloseTo(1.0);
    expect(blog.status).toBe("growing");
    expect(blog.matchedRowCount).toBe(2);
    expect(blog.current.ctr).toBeCloseTo(50 / 800);
  });

  it("returns empty aggregation when nothing matches", () => {
    const result = calculateContentGroups(
      groups,
      [{ client_key: "c", group_key: "blog", url: "https://x.com/nope/", match_type: "starts_with", active: true }],
      current,
      previous,
    );
    expect(result[0].current.clicks).toBe(0);
    expect(result[0].current.position).toBeNull();
  });
});
