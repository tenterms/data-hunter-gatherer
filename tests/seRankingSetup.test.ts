import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

/**
 * Runs the SE Ranking setup actions (add engine / group / keywords) against a
 * local stub returning the documented response shapes, asserting the exact
 * request bodies the tool sends. Uses the bundled demo client "cyber-alchemy"
 * (cyberalchemy.co.uk) for site matching.
 */

const received: Array<{ method: string; path: string; body: unknown }> = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    received.push({ method: req.method ?? "", path: url.pathname, body });
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && url.pathname === "/sites") {
      res.end(JSON.stringify([{ id: 42, name: "https://cyberalchemy.co.uk/", title: "Cyber Alchemy" }]));
      return;
    }
    if (req.method === "POST" && url.pathname === "/sites/search-engines") {
      res.statusCode = 201;
      res.end(JSON.stringify({ site_engine_id: 77 }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/keywords/groups") {
      res.statusCode = 201;
      res.end(JSON.stringify({ group_id: 55 }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/keywords") {
      res.end(JSON.stringify({ added: 2, ids: [1, 2] }));
      return;
    }
    res.end(JSON.stringify([]));
  });
});

let base = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  process.env.SERANKING_API_BASE = base;
  process.env.SERANKING_SYSTEM_ENGINES_URL = `${base}/system/search-engines`;
  process.env.SERANKING_API_KEY = "test-key";
});
afterAll(() => server.close());

describe("SE Ranking setup actions", () => {
  it("adds a search engine with location to the matched site", async () => {
    const { addSearchEngine } = await import("../src/lib/seRankingSetup");
    const result = await addSearchEngine({
      clientKey: "cyber-alchemy",
      searchEngineId: "200",
      regionName: "New York",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("77");
    const call = received.find((r) => r.method === "POST" && r.path === "/sites/search-engines");
    expect(call?.body).toEqual({ search_engine_id: 200, region_name: "New York" });
  });

  it("creates a keyword group on the site", async () => {
    const { addKeywordGroup } = await import("../src/lib/seRankingSetup");
    const result = await addKeywordGroup({ clientKey: "cyber-alchemy", name: "Pen Testing" });
    expect(result.ok).toBe(true);
    const call = received.find((r) => r.method === "POST" && r.path === "/keywords/groups");
    expect(call?.body).toEqual({ site_id: 42, name: "Pen Testing" });
  });

  it("adds keywords into a group as a documented array payload", async () => {
    const { addKeywords } = await import("../src/lib/seRankingSetup");
    const result = await addKeywords({
      clientKey: "cyber-alchemy",
      keywords: ["penetration testing", " vciso services ", ""],
      groupId: "55",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2 keyword(s)");
    const call = received.find((r) => r.method === "POST" && r.path === "/keywords");
    expect(call?.body).toEqual([
      { keyword: "penetration testing", group_id: 55 },
      { keyword: "vciso services", group_id: 55 },
    ]);
  });

  it("fails clearly when no SE Ranking project matches the domain", async () => {
    const { addKeywordGroup } = await import("../src/lib/seRankingSetup");
    const result = await addKeywordGroup({ clientKey: "apex-design", name: "X" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("No SE Ranking project matches");
  });
});
