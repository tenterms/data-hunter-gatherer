import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/** The bundled proposal file is well-formed and complete for all 8 clients. */
describe("targeting proposal file", () => {
  const data = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "proposals", "targeting-2026-08.json"), "utf8"),
  ) as Record<string, { pages: Array<Record<string, string>>; contentGroups: unknown[]; topicClusters: Array<{ name: string; contains: string[] }> }>;

  it("covers all eight clients by domain", () => {
    expect(Object.keys(data).sort()).toEqual([
      "3point1.design", "aag-it.com", "atlasjetcharter.com", "cyberalchemy.co.uk",
      "ideareality.design", "knightsbridgecircle.com", "solentpower.co.uk", "southernropes.co.uk",
    ]);
  });

  it("every page has a path, label and valid role", () => {
    const roles = new Set(["primary", "secondary", "sector", "supporting", "rest_of_site"]);
    for (const client of Object.values(data)) {
      expect(client.pages.length).toBeGreaterThan(0);
      for (const p of client.pages) {
        expect(p.path.startsWith("/")).toBe(true);
        expect(p.label.length).toBeGreaterThan(0);
        expect(roles.has(p.role)).toBe(true);
      }
    }
  });

  it("every group has at least one contains rule", () => {
    for (const client of Object.values(data)) {
      for (const g of [...client.contentGroups, ...client.topicClusters] as Array<{ contains: string[] }>) {
        expect(g.contains.length).toBeGreaterThan(0);
      }
    }
  });

  it("expands synonyms intelligently (the arborist test)", () => {
    const sr = data["southernropes.co.uk"];
    const arborist = sr.topicClusters.find((t) => t.name === "Arborist");
    expect(arborist?.contains).toContain("arbor");
    expect(arborist?.contains).toContain("tree");
  });
});
