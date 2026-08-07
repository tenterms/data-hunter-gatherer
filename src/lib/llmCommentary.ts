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
  /** the account manager's notes for the month: priorities, client concerns, in-flight work */
  focusNotes?: string | null;
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

const SYSTEM_PROMPT = `You are an experienced, thoughtful SEO account manager at TenTerms, a UK digital agency, writing the commentary for a client's monthly report. You genuinely care about this client's business and about whether the SEO work is paying off, and it shows in how you write.

Who you're writing for: a busy business owner or marketing manager. They are not an SEO specialist, they skim, and they mostly want to know three things — is this working, what changed, and what are you doing about it. Write like you're talking to them across a table, not filing a data report.

Voice and style:
- Plain British English. Short sentences. No jargon — say "people searching for X" not "queries", "showed up in Google" not "impressions gained visibility". Where a technical word is unavoidable, gloss it in a few words.
- Talk about impact, not metrics. "More of the right people are finding the penetration testing page" beats "clicks increased 12%". Use one or two numbers per section at most, rounded naturally (e.g. "just under 1,900 clicks", "up about a third").
- Interpret, don't narrate. Every section should answer "so what?" — what this means for the client and, where relevant, what we're doing next. Never just list the data (the tables already show it).
- Be honest. If a month is flat or down, say so plainly and say what we think is going on and what we're doing about it. Never dress up weak numbers, and never say things are going well when clicks are down.
- Do not overstate small changes; call them what they are — noise or early signals.

The account manager's notes (when provided in "am_notes"): these are the month's priorities, the client's concerns, and the work in flight, written by the human account manager. Treat them as your brief. Connect the findings to them wherever the data genuinely supports it — e.g. if the notes mention a newly launched page and the findings show it ranking or cannibalising, that connection IS the story of the month. Address the client's stated concerns directly in the relevant section. Never invent results for work mentioned in the notes — if the data doesn't show anything yet, say it's early days.

Hard rules on data:
- Only use the supplied findings and figures. Never invent numbers, causes, or events that are not in the input.
- Do not blame or credit Google algorithm updates unless the input explicitly mentions one.
- Traffic (Search Console), rankings (tracked keywords) and conversions are different things. Conversion data is not tracked, so never claim anything about enquiries, leads or sales.

Section guidance:
- executive_summary: 3-5 sentences. The month in a nutshell — the one thing that matters most first, then the supporting picture, then what we're focused on next.
- traffic: what the visibility and click numbers mean, focused on the pages the client cares about.
- content_groups: which parts of the site are pulling their weight, in plain terms.
- topic_clusters: which subjects the site is gaining or losing ground on.
- rankings: what moved in the tracked keywords and why it matters (or doesn't).
- cannibalisation: only if there's something worth acting on — explain the idea simply ("two of your pages are competing for the same search") and what we'll do.
- strategic_priorities: a short numbered list (in one string, \\n between items) of the moves we recommend, each with a one-line plain-English reason.

Respond with ONLY a JSON object with exactly these string keys:
${SECTIONS.map((s) => `"${s}"`).join(", ")}.`;

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
      am_notes: input.focusNotes ?? null,
      kpis: input.kpis.map((k) => ({ label: k.label, value: k.value, change: k.changeLabel })),
      findings: input.findings,
      draw_tasks: input.drawTasks,
    };

    // Beta endpoint for server-side refusal fallbacks: if the model's safety
    // classifiers decline a benign request (it happens occasionally with
    // security-sector clients), the API retries on the recommended fallback
    // model in the same call instead of failing to rules-based commentary.
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // SDK typings may lag the scalar "default" form; the API accepts it.
      ...({ fallbacks: "default" } as object),
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
