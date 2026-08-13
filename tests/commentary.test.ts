import { describe, expect, it } from "vitest";
import { buildCommentary } from "../src/lib/commentary";
import { generateRulesCommentary } from "../src/lib/commentaryRules";
import type { CommentaryInput, LlmCommentaryProvider } from "../src/lib/llmCommentary";
import type { CommentarySection, Findings, NarrativeOverrideRow } from "../src/lib/types";

const findings: Findings = {
  executive_findings: [
    { id: "1", kind: "clicks_change", sentiment: "positive", text: "Total clicks rose from 384 to 392 (+2.1%)." },
  ],
  traffic_findings: [],
  content_group_findings: [],
  topic_cluster_findings: [],
  cannibalisation_findings: [],
  ranking_findings: [],
  strategic_priority_candidates: [
    { id: "2", kind: "priority", sentiment: "neutral", text: "Publish the sector pages." },
  ],
};

const llmInput = { clientName: "Test Co", periodLabel: "June 2026", kpis: [], drawTasks: [] };

const failingProvider: LlmCommentaryProvider = {
  name: "broken",
  async generateCommentary() {
    throw new Error("no network");
  },
};

const workingProvider: LlmCommentaryProvider = {
  name: "fake-llm",
  async generateCommentary(_input: CommentaryInput) {
    const sections: CommentarySection[] = [
      "executive_summary",
      "traffic",
      "content_groups",
      "topic_clusters",
      "cannibalisation",
      "rankings",
      "strategic_priorities",
    ];
    return Object.fromEntries(sections.map((s) => [s, `LLM text for ${s}`])) as Record<
      CommentarySection,
      string
    >;
  },
};

describe("rules commentary", () => {
  it("always produces text for every section, even with empty findings", () => {
    const empty: Findings = {
      executive_findings: [],
      traffic_findings: [],
      content_group_findings: [],
      topic_cluster_findings: [],
      cannibalisation_findings: [],
      ranking_findings: [],
      strategic_priority_candidates: [],
    };
    const text = generateRulesCommentary(empty);
    for (const [section, value] of Object.entries(text)) {
      // Strategic priorities are the account manager's own words, so the
      // rules engine deliberately leaves that section empty.
      if (section === "strategic_priorities") {
        expect(value).toBe("");
        continue;
      }
      expect(value.length).toBeGreaterThan(10);
    }
  });
  it("uses finding text verbatim (no invented numbers)", () => {
    const text = generateRulesCommentary(findings);
    expect(text.executive_summary).toContain("384 to 392");
  });
});

describe("commentary fallback behaviour", () => {
  it("uses rules_only when no LLM provider exists", async () => {
    const result = await buildCommentary({
      findings,
      llmInput,
      requestedMode: "llm_draft",
      llmProvider: null,
      overrides: [],
      clientKey: "c",
      periodKey: "p",
    });
    expect(result.every((c) => c.suggestedSource === "rules_only")).toBe(true);
    expect(result.every((c) => c.finalText === c.suggestedText)).toBe(true);
  });

  it("falls back to rules when the LLM fails", async () => {
    const result = await buildCommentary({
      findings,
      llmInput,
      requestedMode: "llm_draft",
      llmProvider: failingProvider,
      overrides: [],
      clientKey: "c",
      periodKey: "p",
    });
    expect(result.every((c) => c.suggestedSource === "rules_only")).toBe(true);
  });

  it("uses the LLM draft when it succeeds", async () => {
    const result = await buildCommentary({
      findings,
      llmInput,
      requestedMode: "llm_draft",
      llmProvider: workingProvider,
      overrides: [],
      clientKey: "c",
      periodKey: "p",
    });
    expect(result.find((c) => c.section === "traffic")?.suggestedText).toBe("LLM text for traffic");
    expect(result.every((c) => c.mode === "llm_draft")).toBe(true);
  });

  it("human override wins over both, per section, and keeps the suggestion", async () => {
    const overrides: NarrativeOverrideRow[] = [
      {
        client_key: "c",
        period_key: "p",
        section: "executive_summary",
        suggested_text: "",
        override_text: "The strategist wrote this instead.",
        final_text: "",
        approved_by: "tester",
        approved_at: "2026-07-01",
      },
    ];
    const result = await buildCommentary({
      findings,
      llmInput,
      requestedMode: "llm_draft",
      llmProvider: workingProvider,
      overrides,
      clientKey: "c",
      periodKey: "p",
    });
    const exec = result.find((c) => c.section === "executive_summary")!;
    expect(exec.mode).toBe("human_override");
    expect(exec.finalText).toBe("The strategist wrote this instead.");
    expect(exec.suggestedText).toBe("LLM text for executive_summary"); // suggestion preserved
    const traffic = result.find((c) => c.section === "traffic")!;
    expect(traffic.mode).toBe("llm_draft"); // other sections unaffected
  });

  it("ignores overrides for other clients/periods", async () => {
    const overrides: NarrativeOverrideRow[] = [
      {
        client_key: "other-client",
        period_key: "p",
        section: "executive_summary",
        suggested_text: "",
        override_text: "Wrong client override.",
        final_text: "",
        approved_by: "",
        approved_at: "",
      },
    ];
    const result = await buildCommentary({
      findings,
      llmInput,
      requestedMode: "rules_only",
      llmProvider: null,
      overrides,
      clientKey: "c",
      periodKey: "p",
    });
    expect(result.find((c) => c.section === "executive_summary")?.mode).toBe("rules_only");
  });
});
