import Anthropic from "@anthropic-ai/sdk";
import type {
  CommentarySection,
  DrawTaskRow,
  Findings,
  KpiCardData,
} from "./types";

/**
 * Optional LLM commentary layer.
 *
 * The LLM's role is wording, summarisation and tone — never data analysis.
 * It receives only the structured findings (already calculated in code) plus
 * small metric summaries, and is instructed to use nothing else. If anything
 * fails (no key, network, unparseable output) the caller falls back to the
 * rules-based commentary, so the app never depends on an LLM being available.
 *
 * Providers are behind an interface so OpenAI or another vendor can be added
 * later without touching the report generator.
 */

export interface CommentaryInput {
  clientName: string;
  periodLabel: string;
  kpis: KpiCardData[];
  findings: Findings;
  drawTasks: Array<Pick<DrawTaskRow, "timing" | "category" | "title">>;
}

export interface LlmCommentaryProvider {
  readonly name: string;
  generateCommentary(input: CommentaryInput): Promise<Record<CommentarySection, string>>;
}

const SECTIONS: CommentarySection[] = [
  "executive_summary",
  "traffic",
  "content_groups",
  "topic_clusters",
  "cannibalisation",
  "rankings",
  "strategic_priorities",
];

const SYSTEM_PROMPT = `You write monthly SEO report commentary for a UK digital agency. You will be given a structured set of findings that were calculated deterministically in code, plus KPI summaries and the month's task list.

Rules you must follow:
- Only use the supplied findings and figures. Never invent numbers, causes, or events that are not in the input.
- If the supplied findings are weak or inconclusive, say so plainly rather than dressing them up.
- Write in plain British English with a calm, commercially useful tone.
- Do not overstate small changes.
- Do not mention unsupported causes, and do not blame Google updates unless update context is explicitly included in the findings.
- Distinguish clearly between traffic (GSC), rankings (tracked keywords), and conversions. Conversion data is not tracked yet, so never claim anything about enquiries or sales.
- Never say performance is good if clicks are weak.
- Keep the executive summary concise (3-5 sentences).
- Produce commentary a strategist can lightly edit before sending to a client.

Respond with ONLY a JSON object with exactly these string keys:
${SECTIONS.map((s) => `"${s}"`).join(", ")}.
For strategic_priorities, format as a short numbered list in a single string (use \\n between items).`;

export class AnthropicCommentaryProvider implements LlmCommentaryProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async generateCommentary(input: CommentaryInput): Promise<Record<CommentarySection, string>> {
    const userPayload = {
      client_name: input.clientName,
      reporting_period: input.periodLabel,
      kpis: input.kpis.map((k) => ({ label: k.label, value: k.value, change: k.changeLabel })),
      findings: input.findings,
      draw_tasks: input.drawTasks,
    };

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write the report commentary from these findings:\n\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: Object.fromEntries(SECTIONS.map((s) => [s, { type: "string" }])),
            required: SECTIONS,
            additionalProperties: false,
          },
        },
      },
    });

    if (response.stop_reason === "refusal") {
      throw new Error("LLM declined to generate commentary");
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("LLM returned no text content");

    const parsed = JSON.parse(text) as Record<string, unknown>;
    const result = {} as Record<CommentarySection, string>;
    for (const section of SECTIONS) {
      const value = parsed[section];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`LLM output missing section "${section}"`);
      }
      result[section] = value.trim();
    }
    return result;
  }
}

export function createLlmProvider(
  apiKey: string | null,
  model: string,
): LlmCommentaryProvider | null {
  if (!apiKey) return null;
  return new AnthropicCommentaryProvider(apiKey, model);
}
