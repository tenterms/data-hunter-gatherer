import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import type { ClientRow, ReportPeriodRow } from "../src/lib/types";

/**
 * Runs the live SE Ranking adapter against a local stub that returns the
 * exact response shapes from SE Ranking's API docs
 * (https://seranking.com/api/project/project-management/), including the
 * gotcha that /sites/positions carries keyword IDs but no keyword names.
 */

const client: ClientRow = {
  client_key: "acme",
  client_name: "Acme",
  domain: "acmewidgets.co.uk",
  gsc_property_url: "sc-domain:acmewidgets.co.uk",
  timezone: "Europe/London",
  active: true,
  notes: "",
};

const period: ReportPeriodRow = {
  period_key: "2026-06",
  client_key: "acme",
  label: "June 2026",
  start_date: "2026-06-01",
  end_date: "2026-06-30",
  comparison_start_date: "2026-05-01",
  comparison_end_date: "2026-05-31",
  status: "pending",
};

// Documented response shapes, verbatim field names.
const fixtures: Record<string, unknown> = {
  "/sites": [
    { id: 507052, name: "https://acmewidgets.co.uk/", title: "Acme Widgets", keyword_count: 4 },
    { id: 111111, name: "https://othersite.com/", title: "Other Site", keyword_count: 9 },
  ],
  "/sites/search-engines": [
    { site_engine_id: 2001, search_engine_id: 200, region_name: "London", lang_code: "en" },
    { site_engine_id: 2002, search_engine_id: 200, region_name: "Manchester", lang_code: "en" },
  ],
  "/keywords": [
    { id: "1", name: "widgets uk", group_id: "10", link: null },
    { id: "2", name: "buy widgets", group_id: "10", link: "https://acmewidgets.co.uk/shop" },
    { id: "3", name: "widget repair", group_id: "11", link: null },
    { id: "4", name: "ungrouped keyword", group_id: null, link: null },
  ],
  "/keywords/groups": [
    { id: "10", name: "Commercial", creation_date: "2025-01-01" },
    { id: "11", name: "Services", creation_date: "2025-01-01" },
  ],
  "/system/search-engines": [{ id: 200, name: "Google.co.uk" }],
  "/sites/positions": [
    {
      site_engine_id: 2001,
      keywords: [
        {
          id: "1",
          positions: [
            { date: "2026-06-01", pos: 12 },
            { date: "2026-06-30", pos: 4 },
          ],
          volume: 390,
        },
        {
          id: "2",
          positions: [
            { date: "2026-06-01", pos: 8 },
            { date: "2026-06-30", pos: 8 },
          ],
          volume: 720,
        },
        // unknown keyword id: no name anywhere, must be skipped not crash
        { id: "99", positions: [{ date: "2026-06-15", pos: 3 }], volume: 10 },
      ],
    },
    {
      site_engine_id: 2002,
      keywords: [
        {
          id: "3",
          positions: [
            { date: "2026-06-01", pos: 0 },
            { date: "2026-06-30", pos: 6 },
          ],
          volume: 90,
        },
      ],
    },
  ],
};

let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.headers.authorization !== "Token test-key") {
      res.writeHead(401).end(JSON.stringify({ message: "unauthorised" }));
      return;
    }
    let body = fixtures[url.pathname];
    if (!body) {
      res.writeHead(404).end("{}");
      return;
    }
    // Like the real API, a site_engine_id filter narrows positions to one engine.
    const engineFilter = url.searchParams.get("site_engine_id");
    if (url.pathname === "/sites/positions" && engineFilter) {
      body = (body as Array<{ site_engine_id: number }>).filter(
        (b) => String(b.site_engine_id) === engineFilter,
      );
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  process.env.SERANKING_API_BASE = `http://127.0.0.1:${port}`;
  process.env.SERANKING_SYSTEM_ENGINES_URL = `http://127.0.0.1:${port}/system/search-engines`;
});

afterAll(async () => {
  delete process.env.SERANKING_API_BASE;
  delete process.env.SERANKING_SYSTEM_ENGINES_URL;
  await new Promise((resolve) => server.close(resolve));
});

describe("SERankingProvider against documented API shapes", () => {
  it("returns one engine block per search engine with real keyword names and groups", async () => {
    const { SERankingProvider } = await import("../src/lib/rankings");
    const provider = new SERankingProvider("test-key");
    const engines = await provider.getEngineData(client, period);

    expect(engines).not.toBeNull();
    expect(engines!.length).toBe(2);

    const [london, manchester] = engines!;
    expect(london.id).toBe("2001");
    expect(london.label).toBe("Google.co.uk — London");
    expect(manchester.label).toBe("Google.co.uk — Manchester");

    // Keyword names joined from /keywords, not the bare IDs in /sites/positions.
    const names = london.movements.map((m) => m.keyword);
    expect(names).toEqual(["widgets uk", "buy widgets"]); // id 99 has no name and is skipped
    expect(london.movements[0]).toMatchObject({
      startPosition: 12,
      endPosition: 4,
      change: 8,
      direction: "up",
      searchVolume: 390,
      groupName: "Commercial",
    });

    // pos 0 means unranked -> "entered" during the period.
    expect(manchester.movements[0]).toMatchObject({
      keyword: "widget repair",
      direction: "entered",
      groupName: "Services",
    });
  });

  it("probe reports a healthy connection line by line", async () => {
    const { SERankingProvider } = await import("../src/lib/rankings");
    const provider = new SERankingProvider("test-key");
    const lines = await provider.probe(client, period);
    expect(lines.some((l) => l.includes("API key works"))).toBe(true);
    expect(lines.some((l) => l.includes("Matched project"))).toBe(true);
    expect(lines.some((l) => l.includes("Google.co.uk — London"))).toBe(true);
    expect(lines.some((l) => l.startsWith("✗"))).toBe(false);
  });

  it("probe explains a wrong API key", async () => {
    const { SERankingProvider } = await import("../src/lib/rankings");
    const provider = new SERankingProvider("wrong-key");
    const lines = await provider.probe(client, period);
    expect(lines[0]).toContain("✗");
    expect(lines[0]).toContain("401");
  });
});
