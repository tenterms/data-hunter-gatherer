import type {
  CommentarySection,
  Findings,
  NarrativeOverrideRow,
  SectionCommentary,
} from "./types";
import { generateRulesCommentary } from "./commentaryRules";
import type { CommentaryInput, LlmCommentaryProvider } from "./llmCommentary";

/**
 * Commentary orchestration — always runs the deterministic findings first
 * (upstream), then chooses rules-based or LLM-drafted wording, then applies
 * any human overrides from the NarrativeOverrides sheet.
 *
 * Modes:
 *  - rules_only:     deterministic templates (default; works with no API key)
 *  - llm_draft:      LLM re-words the findings; falls back to rules on any error
 *  - human_override: per-section, whenever override_text is present in the sheet
 */

const SECTIONS: CommentarySection[] = [
  "executive_summary",
  "traffic",
  "content_groups",
  "topic_clusters",
  "cannibalisation",
  "rankings",
  "strategic_priorities",
];

export interface BuildCommentaryOptions {
  findings: Findings;
  llmInput: Omit<CommentaryInput, "findings">;
  requestedMode: "rules_only" | "llm_draft";
  llmProvider: LlmCommentaryProvider | null;
  overrides: NarrativeOverrideRow[];
  clientKey: string;
  periodKey: string;
  log?: (message: string) => void;
}

export async function buildCommentary(options: BuildCommentaryOptions): Promise<SectionCommentary[]> {
  const log = options.log ?? (() => {});
  const rulesText = generateRulesCommentary(options.findings);

  let suggested: Record<CommentarySection, string> = rulesText;
  let suggestedSource: "rules_only" | "llm_draft" = "rules_only";

  if (options.requestedMode === "llm_draft" && options.llmProvider) {
    try {
      suggested = await options.llmProvider.generateCommentary({
        ...options.llmInput,
        findings: options.findings,
      });
      suggestedSource = "llm_draft";
      log(`Commentary drafted by LLM provider "${options.llmProvider.name}".`);
    } catch (error) {
      log(
        `LLM commentary failed (${error instanceof Error ? error.message : String(error)}); falling back to rules-based commentary.`,
      );
      suggested = rulesText;
      suggestedSource = "rules_only";
    }
  }

  return SECTIONS.map((section) => {
    const override = options.overrides.find(
      (o) =>
        o.client_key === options.clientKey &&
        o.period_key === options.periodKey &&
        o.section === section &&
        o.override_text.trim() !== "",
    );
    const overrideText = override ? override.override_text.trim() : null;
    return {
      section,
      suggestedText: suggested[section],
      suggestedSource,
      overrideText,
      finalText: overrideText ?? suggested[section],
      mode: overrideText ? "human_override" : suggestedSource,
    };
  });
}
