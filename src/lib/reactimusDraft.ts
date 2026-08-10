import Anthropic from "@anthropic-ai/sdk";
import type { PageContentRow } from "@/reactimus/types";

/**
 * Before/After drafting for Reactimus action rows.
 *
 * The team's manual workflow (and the client-facing spreadsheet it feeds)
 * works in exact edits: the sentence currently on the page, and the rewritten
 * sentence with the keyword woven in. Claude drafts those pairs from the
 * fetched page content; every "before" is validated as genuinely present on
 * the page before it is trusted, and a heuristic fallback covers LLM-off runs.
 */

export interface DraftableAction {
  key: string;
  action: "H2 edit" | "Copy edit" | "FAQ";
  keyword: string;
  variants: string;
}

export interface BeforeAfter {
  before: string;
  after: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** True when `text` genuinely appears in the fetched page. */
export function appearsOnPage(text: string, page: PageContentRow): boolean {
  const needle = norm(text);
  if (needle.length < 8) return false;
  const haystacks = [page.bodyText, page.titleTag, page.h1, ...page.h2s].map(norm);
  return haystacks.some((h) => h.includes(needle));
}

export function splitSentences(bodyText: string): string[] {
  return bodyText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 320);
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "in", "for", "to", "with", "on", "at", "is", "are", "we", "our", "you", "your", "it"]);

export function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** The page sentence with the most keyword-token overlap (ties → earlier). */
export function pickAnchorSentence(page: PageContentRow, phrase: string): string {
  const tokens = contentTokens(phrase);
  if (tokens.length === 0) return "";
  let best = "";
  let bestScore = 0;
  for (const sentence of splitSentences(page.bodyText)) {
    const sTokens = new Set(contentTokens(sentence));
    const score = tokens.filter((t) => sTokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return bestScore > 0 ? best : "";
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Deterministic fallback when Claude isn't available or a draft fails. */
export function heuristicBeforeAfter(action: DraftableAction, page: PageContentRow): BeforeAfter {
  if (action.action === "H2 edit") {
    const anchor = pickAnchorSentence(page, action.keyword);
    const nearH2 = page.h2s.find((h) => contentTokens(h).some((t) => contentTokens(action.keyword).includes(t)));
    return {
      before: nearH2 ?? "",
      after: `H2: ${titleCase(action.keyword)}${anchor ? `\nOpen the section with a reworked version of: "${anchor}"` : ""}`,
    };
  }
  if (action.action === "FAQ") {
    return {
      before: "",
      after: `H3: ${titleCase(action.keyword)}?\nAnswer in 2–3 plain sentences drawing on the page, ending with a next step (e.g. a link to contact).`,
    };
  }
  const anchor = pickAnchorSentence(page, action.keyword);
  return {
    before: anchor,
    after: anchor
      ? `Rework this sentence so it naturally includes "${action.keyword}".`
      : `Add one sentence using "${action.keyword}" naturally to the most relevant section.`,
  };
}

// ---------------------------------------------------------------------------
// Claude drafting (one call per page, covering all of that page's edits)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You are a senior SEO copy editor producing precise before/after edits for a client's live web page, in the exact format the team's edit tracker uses.",
  "",
  "For each requested edit you are given a target search phrase. Your job:",
  '- "before": copy ONE sentence or heading VERBATIM from the supplied page content that the edit will modify. Character-for-character exact. Never invent, trim words from, or paraphrase the before text.',
  '- "after": the rewritten version, publishable as-is.',
  "",
  "Hard rules:",
  "- The target phrase (or a close grammatical inflection of it) MUST appear in the after text. An edit whose after text omits the phrase is worthless.",
  "- The after text must read like the site's own copy: natural British English, grounded only in facts visible in the page content, no invented claims, no placeholders or brackets.",
  "- Never use em dashes or en dashes. No exclamation marks.",
  '- Vary sentence constructions. Do not start more than one edit with "As a" or "As an".',
  "- Keep each edit self-contained: if the before sentence introduces a list or sits inside one, the after must still work in that position.",
  "- H2 edit: before = the existing H2 being reworked (verbatim from the page's H2 list), or empty if a brand-new section fits better. After = 'H2: ' followed by the new heading, then optionally one short opening sentence on a new line.",
  "- FAQ: before = empty. After = 'H3: ' followed by a natural customer question using the phrase, then a 2-3 sentence answer grounded in the page, ending with a gentle next step.",
  "- Copy edit: before = one verbatim body sentence. After = that sentence reworked to include the phrase without changing its meaning or breaking grammar.",
].join("\n");

export async function draftBeforeAfters(
  apiKey: string,
  model: string,
  clientName: string,
  page: PageContentRow,
  actions: DraftableAction[],
  log: (m: string) => void,
): Promise<Map<string, BeforeAfter>> {
  const out = new Map<string, BeforeAfter>();
  if (actions.length === 0) return out;

  const client = new Anthropic({ apiKey });
  const requests = actions
    .map((a, i) => `${i + 1}. [${a.action}] target phrase: "${a.keyword}"${a.variants ? ` (searchers also type: ${a.variants})` : ""}`)
    .join("\n");
  const pageBlock = [
    `Client: ${clientName}`,
    `URL: ${page.url}`,
    `Title: ${page.titleTag}`,
    `H1: ${page.h1}`,
    `H2s:\n${page.h2s.map((h) => `- ${h}`).join("\n")}`,
    `Body text:\n${page.bodyText.slice(0, 9000)}`,
  ].join("\n\n");

  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `PAGE CONTENT\n\n${pageBlock}\n\nEDITS REQUESTED\n\n${requests}\n\nReturn a before/after pair for each numbered edit.`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              edits: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "integer" },
                    before: { type: "string" },
                    after: { type: "string" },
                  },
                  required: ["index", "before", "after"],
                  additionalProperties: false,
                },
              },
            },
            required: ["edits"],
            additionalProperties: false,
          },
        },
      },
    });
    if (response.stop_reason === "refusal") throw new Error("model refused");
    const text = response.content.find((b) => b.type === "text");
    const parsed = JSON.parse(text && text.type === "text" ? text.text : "{}") as {
      edits?: Array<{ index: number; before: string; after: string }>;
    };
    for (const edit of parsed.edits ?? []) {
      const action = actions[edit.index - 1];
      if (!action) continue;
      const before = edit.before.trim();
      const after = edit.after.trim();
      if (!after) continue;
      // A "before" that isn't really on the page would be worse than none:
      // the whole point of the format is that the team can find the sentence.
      if (before && !appearsOnPage(before, page)) {
        log(`Draft for "${action.keyword}" quoted text not on the page — kept the heuristic anchor instead.`);
        continue;
      }
      out.set(action.key, { before, after });
    }
  } catch (err) {
    log(`Claude drafting unavailable for ${page.url}: ${(err as Error).message}`);
  }
  return out;
}
