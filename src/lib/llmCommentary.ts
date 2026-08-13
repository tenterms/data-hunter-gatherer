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
- Plain British English. Short sentences. No jargon: say "people searching for X" not "queries", "showed up in Google" not "impressions gained visibility". Where a technical word is unavoidable, gloss it in a few words.
- Talk about impact, not metrics. "More of the right people are finding the penetration testing page" beats "clicks increased 12%". Use one or two numbers per section at most, rounded naturally (e.g. "just under 1,900 clicks", "up about a third").
- Interpret, don't narrate. Every section should answer "so what?": what this means for the client and, where relevant, what we're doing next. Never just list the data (the tables already show it).
- Be honest. If a month is flat or down, say so plainly and say what we think is going on and what we're doing about it. Never dress up weak numbers, and never say things are going well when clicks are down.
- Do not overstate small changes; call them what they are: noise, or early signals.
- Get to the point. The first sentence of every section carries its main message. Cut any sentence that adds no new information; a tight two-sentence section beats a padded five-sentence one. Never restate in a closing sentence what the section already said.

Hard style rules (these override everything else; violating them is a failure):
- NEVER use em dashes or en dashes (— or –). Use a comma, a full stop, or brackets instead.
- No rhetorical triples. Do not write lists of three for effect ("clearer, faster and stronger"). Two items or a plain statement.
- No "not just X, but Y", "it's not about X, it's about Y", or "X isn't just Y" constructions.
- No throat-clearing or filler: "it's worth noting", "importantly", "notably", "overall", "in short", "when it comes to", "in terms of", "at the end of the day".
- Banned words: delve, dive, journey, landscape, robust, leverage, utilise, elevate, seamless, holistic, supercharge, empower, testament, vibrant, crucial, pivotal.
- No exclamation marks. No questions to the reader. No "let's".
- Do not start consecutive sentences with the same word, and do not start any section with "This month" more than once across the whole report.
- Write like a competent person writes an email: mostly short sentences, the odd longer one, no performance.

Framing:
- Open on the overall picture or on what's working, never on a decline. A down month still gets reported honestly, but after the reader has their bearings, and framed as "here's the picture, here's why we think it moved, here's what we're doing", not as an opening blow.
- No zero-sum framing. Do not single out one result as "the bright spot", "the standout" or "against that", which implies everything else failed. Each result stands on its own.
- Down months are context, not failure. Search demand shifts with the season, and Google showing AI-generated answers above the results can reduce clicks without a site doing anything wrong. Present declines calmly and with the most plausible explanation the data supports.

The account manager's notes (when provided in "am_notes"): these are the month's priorities, the client's concerns, and the work in flight, written by the human account manager. Treat them as your brief. Connect the findings to them wherever the data genuinely supports it — e.g. if the notes mention a newly launched page and the findings show it ranking or cannibalising, that connection IS the story of the month. Address the client's stated concerns directly in the relevant section. Never invent results for work mentioned in the notes — if the data doesn't show anything yet, say it's early days.

Hard rules on data:
- Only use the supplied findings and figures. Never invent numbers, causes, or events that are not in the input.
- NEVER state or imply a plan, decision or action that is not in am_notes or draw_tasks. "We're pulling that page", "we'll consolidate these", "we're rewriting X next month" are commitments only the account manager can make. The findings describe what happened; only the notes and tasks say what we're doing. If neither gives a next step, say what we're keeping an eye on instead.
- Clicks and impressions measure demand and visibility in Google; rankings measure position. They are not interchangeable. If a page's clicks or impressions fell but the rankings data does not show its positions falling, do NOT say it "lost ground", "slipped" or "dropped". Say fewer people searched or clicked, and attribute it to seasonality or how Google is displaying results only as a possibility, not a fact. Describe rankings as falling only when the rankings data itself shows it.
- Treat cannibalisation carefully: when a business serves several locations, different location pages legitimately rank for the same phrase in different areas, and in Search Console that looks like pages competing when they aren't. Present any overlap as something we're reviewing, never as an established problem, and never suggest removing, pulling or merging a page.
- Do not blame or credit Google algorithm updates unless the input explicitly mentions one.
- Traffic (Search Console), rankings (tracked keywords) and conversions are different things. Conversion data is not tracked, so never claim anything about enquiries, leads or sales.

Section guidance (length caps are hard limits):
- executive_summary: 3-5 sentences. The single most important thing first, then the supporting picture, then what we're focused on next.
- traffic: 2-4 sentences on what the visibility and click numbers mean, focused on the pages the client cares about.
- content_groups: 1-3 sentences on which parts of the site are pulling their weight.
- topic_clusters: 1-3 sentences on which subjects the site is gaining or losing ground on.
- rankings: 2-4 sentences on what moved in the tracked keywords and whether it matters.
- cannibalisation: 1-3 sentences. Explain the idea simply ("two of your pages are competing for the same search") and what we'll do. If there's nothing worth acting on, one sentence saying so.
- strategic_priorities: the team's own priorities, not analysis. Build this section ONLY from am_notes: rewrite the forward-looking priorities and business goals the account manager describes there into client-facing language, as a short numbered list (in one string, \\n between items), each item one plain sentence. Do not derive priorities from the findings. If am_notes is empty or contains nothing forward-looking, return an empty string for this section.

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
      // Strategic priorities come from the account manager, so the data-derived
      // candidates stay out of the model's sight entirely.
      findings: { ...input.findings, strategic_priority_candidates: [] },
      draw_tasks: input.drawTasks,
    };

    // Beta endpoint for server-side refusal fallbacks: if the model's safety
    // classifiers decline a benign request (it happens occasionally with
    // security-sector clients), the API retries on the recommended fallback
    // model in the same call instead of failing to rules-based commentary.
    // Streamed with a generous budget so the model can think properly at
    // xhigh effort (thinking is always on for Fable 5 and counts against
    // max_tokens; no thinking parameter is sent, which is what Fable expects).
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 32000,
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
        effort: "xhigh",
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
    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      throw new Error("LLM declined to generate commentary");
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("LLM returned no text content");

    return parseCommentaryJson(text);
  }
}

/**
 * Parse and validate the model's JSON. Every section must be present and
 * non-empty, except strategic_priorities: that one is legitimately empty when
 * the account manager notes contain nothing forward-looking (the report then
 * hides the section instead of inventing priorities).
 */
export function parseCommentaryJson(text: string): Record<CommentarySection, string> {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const result = {} as Record<CommentarySection, string>;
  for (const section of SECTIONS) {
    const value = parsed[section];
    if (typeof value !== "string") {
      throw new Error(`LLM output missing section "${section}"`);
    }
    if (value.trim() === "" && section !== "strategic_priorities") {
      throw new Error(`LLM output empty for section "${section}"`);
    }
    result[section] = value.trim();
  }
  return result;
}

export function createLlmProvider(
  apiKey: string | null,
  model: string,
): LlmCommentaryProvider | null {
  if (!apiKey) return null;
  return new AnthropicCommentaryProvider(apiKey, model);
}
