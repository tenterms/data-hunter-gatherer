import { describe, expect, it } from "vitest";
import { calculateTopicClusters, clusterMatchesQuery, queryMatchesRule } from "../src/lib/topicClusters";
import type { GscRow, TopicClusterRow, TopicClusterRuleRow } from "../src/lib/types";

const query = (q: string, clicks: number, impressions: number): GscRow => ({
  keys: [q],
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position: 8,
});

describe("queryMatchesRule", () => {
  it("contains is case-insensitive by default", () => {
    expect(queryMatchesRule("Best Product Design UK", "product design", "contains", false)).toBe(true);
    expect(queryMatchesRule("Best Product Design UK", "product design", "contains", true)).toBe(false);
  });
  it("exact requires the full query", () => {
    expect(queryMatchesRule("product design", "product design", "exact", false)).toBe(true);
    expect(queryMatchesRule("product design services", "product design", "exact", false)).toBe(false);
  });
  it("regex matches patterns and survives invalid patterns", () => {
    expect(queryMatchesRule("prototype my idea", "^proto", "regex", false)).toBe(true);
    expect(queryMatchesRule("anything", "([unclosed", "regex", false)).toBe(false);
  });
});

describe("clusterMatchesQuery (contains / doesn't contain)", () => {
  const rule = (match_type: "contains" | "not_contains", query_text: string) => ({
    client_key: "c",
    topic_key: "t",
    match_type,
    query_text,
    case_sensitive: false,
    active: true,
  });

  it("matches when any include chip matches", () => {
    const rules = [rule("contains", "baby product"), rule("contains", "baby design")];
    expect(clusterMatchesQuery("baby product designers", rules)).toBe(true);
    expect(clusterMatchesQuery("garden furniture", rules)).toBe(false);
  });

  it("excludes queries hit by any doesn't-contain chip", () => {
    const rules = [rule("contains", "sport"), rule("not_contains", "outdoor")];
    expect(clusterMatchesQuery("sports product design", rules)).toBe(true);
    expect(clusterMatchesQuery("outdoor sports equipment", rules)).toBe(false);
  });

  it("never matches with only exclusions", () => {
    expect(clusterMatchesQuery("anything", [rule("not_contains", "x")])).toBe(false);
  });

  it("ignores inactive rules", () => {
    const rules = [rule("contains", "sport"), { ...rule("not_contains", "outdoor"), active: false }];
    expect(clusterMatchesQuery("outdoor sport", rules)).toBe(true);
  });
});

describe("calculateTopicClusters", () => {
  const clusters: TopicClusterRow[] = [
    { client_key: "c", topic_key: "design", topic_name: "Design", description: "", active: true },
    { client_key: "c", topic_key: "proto", topic_name: "Prototyping", description: "", active: true },
  ];
  const rules: TopicClusterRuleRow[] = [
    { client_key: "c", topic_key: "design", match_type: "contains", query_text: "design", case_sensitive: false, active: true },
    { client_key: "c", topic_key: "proto", match_type: "contains", query_text: "prototype", case_sensitive: false, active: true },
    { client_key: "c", topic_key: "proto", match_type: "contains", query_text: "prototyping", case_sensitive: false, active: true },
  ];

  it("aggregates matching queries; a query may land in multiple clusters", () => {
    const current = [
      query("design a prototype", 5, 100), // matches BOTH clusters
      query("product design", 10, 200),
      query("prototyping services", 3, 50),
    ];
    const previous = [query("product design", 5, 150)];
    const result = calculateTopicClusters(clusters, rules, current, previous);

    const design = result.find((r) => r.key === "design")!;
    const proto = result.find((r) => r.key === "proto")!;
    expect(design.current.clicks).toBe(15); // both design queries
    expect(proto.current.clicks).toBe(8); // overlap query counted here too
    expect(design.previous.clicks).toBe(5);
    expect(design.status).toBe("growing");
  });

  it("cluster with multiple rules matches any of them", () => {
    const result = calculateTopicClusters(
      clusters,
      rules,
      [query("rapid prototyping", 2, 40), query("build a prototype", 4, 60)],
      [],
    );
    const proto = result.find((r) => r.key === "proto")!;
    expect(proto.current.clicks).toBe(6);
    expect(proto.comparison.clicks.isNew).toBe(true);
  });
});

describe("calculateKeywordClustersFromGroups", () => {
  it("groups movements by SE Ranking group name, ignoring ungrouped keywords", async () => {
    const { calculateKeywordClustersFromGroups } = await import("../src/lib/topicClusters");
    const mv = (keyword: string, groupName: string | null, start: number | null, end: number | null) => {
      const change = start !== null && end !== null ? start - end : null;
      return {
        keyword,
        groupName,
        startPosition: start,
        endPosition: end,
        change,
        direction: (change === null ? "entered" : change > 0 ? "up" : change < 0 ? "down" : "flat") as
          | "up"
          | "down"
          | "flat"
          | "entered",
        searchVolume: null,
        targetUrl: "",
        rankingUrl: "",
      };
    };
    const clusters = calculateKeywordClustersFromGroups([
      mv("pen testing", "Security", 12, 4),
      mv("penetration test", "Security", 8, 8),
      mv("cyber essentials", "Compliance", null, 6),
      mv("stray keyword", null, 3, 3),
    ]);
    expect(clusters.map((c) => c.name)).toEqual(["Security", "Compliance"]);
    expect(clusters[0].tracked).toBe(2);
    expect(clusters[0].up).toBe(1);
    expect(clusters[1].entered).toBe(1);
  });
});
