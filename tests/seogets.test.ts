import { describe, expect, it } from "vitest";
import { deriveCounterpart, type ImportGroupItem } from "../src/lib/seogets";

const item = (name: string, contains: string[]): ImportGroupItem => ({ name, contains, notContains: [] });

describe("deriveCounterpart", () => {
  it("derives a topic cluster 1:1 from a location content group", () => {
    const warnings: string[] = [];
    const derived = deriveCounterpart([item("Sheffield", ["sheffield"])], "content", "Acme IT", warnings);
    expect(derived).toHaveLength(1);
    expect(derived[0]!.name).toBe("Sheffield");
    expect(derived[0]!.contains).toEqual(["sheffield"]);
    expect(warnings).toEqual([]);
  });

  it("turns URL slugs into query phrases", () => {
    const warnings: string[] = [];
    const derived = deriveCounterpart(
      [item("Cyber Security", ["/cyber-security/", "penetration-testing"])],
      "content",
      "Acme IT",
      warnings,
    );
    expect(derived[0]!.contains).toEqual(["cyber security", "penetration testing"]);
  });

  it("turns query phrases into URL fragments when deriving content groups", () => {
    const warnings: string[] = [];
    const derived = deriveCounterpart([item("IT Support", ["it support", "managed it"])], "topic", "Acme IT", warnings);
    expect(derived[0]!.contains).toEqual(["it-support", "managed-it"]);
  });

  it("flags brand terms, deep paths and too-short patterns", () => {
    const warnings: string[] = [];
    const derived = deriveCounterpart(
      [item("Brand", ["acme"]), item("Blog", ["/blog/2024/roundup"]), item("Tiny", ["ab"])],
      "content",
      "Acme IT Services",
      warnings,
    );
    expect(derived[0]!.contains).toEqual(["acme"]);
    expect(warnings.some((w) => w.includes("brand name"))).toBe(true);
    expect(warnings.some((w) => w.includes("deep URL path"))).toBe(true);
    expect(warnings.some((w) => w.includes("too short"))).toBe(true);
    // "Tiny" translated to nothing, so no counterpart is derived for it at all.
    expect(derived.map((d) => d.name)).not.toContain("Tiny");
  });
});

import { parseSeoGetsFilterGroups } from "../src/lib/seogets";

describe("parseSeoGetsFilterGroups (real SEO Gets payload shape)", () => {
  const cyberAlchemyGroups = [
    { name: "AI Services", is_priority: false, filters: [
      { expression: "ai-", operator: "contains" },
      { expression: "knowledge-hub", operator: "notContains" },
    ]},
    { name: "Medical & DTAC", is_priority: false, filters: [
      { expression: "medical|dtac", operator: "contains" },
      { expression: "knowledge", operator: "notContains" },
    ]},
    { name: "Home Page / Cyber Security Consultancy", is_priority: false, filters: [
      { expression: "https://cyberalchemy.co.uk/", operator: "equals" },
    ]},
    { name: "Penetration Testing", is_priority: false, filters: [
      { expression: "penetration", operator: "contains" },
    ]},
  ];

  it("maps contains/notContains/equals filters, splitting pipe expressions", () => {
    const warnings: string[] = [];
    const items = parseSeoGetsFilterGroups(cyberAlchemyGroups, warnings);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ name: "AI Services", contains: ["ai-"], notContains: ["knowledge-hub"] });
    expect(items[1]!.contains).toEqual(["medical", "dtac"]);
    expect(items[1]!.notContains).toEqual(["knowledge"]);
    expect(items[2]!.contains).toEqual([]);
    expect(items[2]!.exact).toEqual(["https://cyberalchemy.co.uk/"]);
    expect(items[3]!.contains).toEqual(["penetration"]);
    expect(warnings).toEqual([]);
  });

  it("derives topic clusters from the parsed groups, dropping untranslatable ones", () => {
    const warnings: string[] = [];
    const items = parseSeoGetsFilterGroups(cyberAlchemyGroups, warnings);
    const derived = deriveCounterpart(items, "content", "Cyber Alchemy", warnings);
    const names = derived.map((d) => d.name);
    // Pen testing and Medical & DTAC translate; the homepage equals-only group doesn't.
    expect(names).toContain("Penetration Testing");
    expect(names).toContain("Medical & DTAC");
    expect(names).not.toContain("Home Page / Cyber Security Consultancy");
    const medical = derived.find((d) => d.name === "Medical & DTAC")!;
    expect(medical.contains).toEqual(["medical", "dtac"]);
    expect(warnings.some((w) => w.includes("no counterpart was derived"))).toBe(true);
  });
});
