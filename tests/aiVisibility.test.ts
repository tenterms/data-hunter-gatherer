import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { classifyMention } from "@/lib/aiVisibility";
import type { ClientRow } from "@/lib/types";

const aag: ClientRow = {
  client_key: "aag", client_name: "AAG IT Services", domain: "aag-it.com",
  gsc_property_url: "sc-domain:aag-it.com", timezone: "", active: true, notes: "",
};

describe("AI visibility mention detection", () => {
  it("full colour when the brand is named in the answer", () => {
    const r = classifyMention(
      "The best IT support companies in Leeds include AAG IT Services, Netitude and Air IT.",
      ["https://www.netitude.co.uk/"], aag,
    );
    expect(r.status).toBe("answer");
    expect(r.snippet).toContain("AAG");
  });

  it("greyed when the domain is only a citation", () => {
    const r = classifyMention(
      "Top providers in Leeds include Netitude and Air IT.",
      ["https://aag-it.com/it-support-leeds/", "https://airit.co.uk/"], aag,
    );
    expect(r.status).toBe("source");
  });

  it("absent when neither answer nor sources mention them", () => {
    const r = classifyMention("Netitude and Air IT lead the market.", ["https://airit.co.uk/"], aag);
    expect(r.status).toBe("absent");
  });

  it("matches the short brand name and www-prefixed citations", () => {
    expect(classifyMention("Many firms rate AAG highly.", [], aag).status).toBe("answer");
    expect(classifyMention("No names here.", ["https://www.aag-it.com/about"], aag).status).toBe("source");
  });
});

describe("AAG prompt seed", () => {
  it("carries the three templates: 11 locations + 3 sectors + 18 combos", () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "proposals", "targeting-2026-08.json"), "utf8"),
    );
    const prompts: Array<{ key: string; prompt: string }> = data["aag-it.com"].aiPrompts;
    expect(prompts).toHaveLength(32);
    expect(prompts.filter((p) => p.key.startsWith("loc-"))).toHaveLength(11);
    expect(prompts.filter((p) => p.key.startsWith("sector-"))).toHaveLength(3);
    expect(prompts.filter((p) => p.key.startsWith("combo-"))).toHaveLength(18);
    expect(prompts[0].prompt).toBe("Who are the best IT Support companies in Chesterfield?");
  });
});
