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
    expect(derived[2]!.contains).toEqual([]);
  });
});
