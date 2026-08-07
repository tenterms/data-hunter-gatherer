import Anthropic from '@anthropic-ai/sdk';
import type { LlmAdapter, LlmScoreReview } from './adapter';
import type {
  GroupScores,
  InputUrlRow,
  PageContentRow,
  QueryGroup,
  SuggestedEditRow,
  ToolConfig,
} from '../types';

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    topicalRelevance: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
    intentMatch: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
    commerciality: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
    distinctTopic: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
    cannibalisationRisk: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
    rationale: { type: 'string' },
  },
  required: [
    'topicalRelevance',
    'intentMatch',
    'commerciality',
    'distinctTopic',
    'cannibalisationRisk',
    'rationale',
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a conservative SEO analyst reviewing Google Search Console query groups against a specific web page.
Score each dimension 0-5 following the client's rubric. Be conservative: do not inflate relevance, do not assume synonyms share intent, and never favour keyword stuffing or topical drift. The core question is: "Is this something someone would search when looking for this specific page?"`;

export class AnthropicAdapter implements LlmAdapter {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(private model: string) {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  }

  async reviewScores(input: {
    group: QueryGroup;
    heuristicScores: GroupScores;
    page: PageContentRow;
    inputMeta?: InputUrlRow;
    config: ToolConfig;
  }): Promise<LlmScoreReview | null> {
    const { group, heuristicScores, page, inputMeta, config } = input;
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: SCORE_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              `Client: ${config.clientName}`,
              config.clientContext ? `Client context: ${config.clientContext}` : '',
              config.businessPriorities ? `Business priorities: ${config.businessPriorities}` : '',
              config.targetLocations.length
                ? `Target locations: ${config.targetLocations.join(', ')}`
                : '',
              config.excludedLocations.length
                ? `Excluded locations: ${config.excludedLocations.join(', ')}`
                : '',
              '',
              `Page URL: ${page.url}`,
              `Title: ${page.titleTag}`,
              `H1: ${page.h1}`,
              `H2s: ${page.h2s.join(' | ')}`,
              `Page type: ${inputMeta?.pageType ?? 'unknown'}; target intent: ${inputMeta?.targetIntent ?? 'unknown'}; primary topic: ${inputMeta?.primaryTopic ?? 'unknown'}`,
              `Body (truncated): ${page.bodyText.slice(0, 3000)}`,
              '',
              `Query group: "${group.canonicalQuery}"`,
              `Variants: ${group.variants.map((v) => v.query).join('; ')}`,
              `Demand: ${group.totalImpressions} impressions, ${group.totalClicks} clicks, avg position ${group.weightedAvgPosition}`,
              '',
              `Heuristic scores (review and correct only if clearly wrong): ${JSON.stringify({
                topicalRelevance: heuristicScores.topicalRelevance,
                intentMatch: heuristicScores.intentMatch,
                commerciality: heuristicScores.commerciality,
                distinctTopic: heuristicScores.distinctTopic,
                cannibalisationRisk: heuristicScores.cannibalisationRisk,
              })}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      });

      if (response.stop_reason === 'refusal') return null;
      const text = response.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') return null;
      return JSON.parse(text.text) as LlmScoreReview;
    } catch (err) {
      console.warn(`LLM scoring failed for "${group.canonicalQuery}": ${(err as Error).message}`);
      return null;
    }
  }

  async draftEdit(input: {
    edit: SuggestedEditRow;
    page?: PageContentRow;
    config: ToolConfig;
  }): Promise<string | null> {
    const { edit, page, config } = input;
    if (!page || page.httpStatus !== 200) return null; // never draft copy for a page we haven't seen
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1500,
        thinking: { type: 'adaptive' },
        system:
          `You write on-page copy for the website of ${config.clientName || 'a client'}. You are given a page's real content and the searches people use to find it. Produce finished, publishable copy that a marketing manager could paste in unchanged.\n\n` +
          `Rules:\n` +
          `- British English. Natural, confident, human. Match the page's existing tone and person (use "we" or the brand name the way the page does).\n` +
          `- The search phrases tell you what people want; they are NOT wording to reproduce. Never echo a search phrase verbatim where it reads unnaturally ("best managed it support provider for businesses in leeds" is a search, not a sentence). Express the same intent the way a person would write it, keeping the important terms (the topic and the location) in natural positions.\n` +
          `- Ground every claim in the supplied page content. Never invent services, numbers, accreditations, client names or guarantees. If the page doesn't support a specific claim, write around it.\n` +
          `- FAQ questions must sound like a real customer asking (e.g. "How do I choose an IT support provider in Leeds?"), sentence case, one question mark. Answers: 2-4 sentences, the direct answer first, a natural next step at the end only where it fits.\n` +
          `- No placeholders, no square brackets, no notes to the editor, no keyword lists, no em dashes. Finished copy only.\n` +
          `- Keep the structural labels ("H2:", "H3:", "Answer:", "Link to:", "Anchor text:") so each piece stays identifiable, and cover every H3 in the outline.`,
        messages: [
          {
            role: 'user',
            content: [
              config.clientContext ? `Client context: ${config.clientContext}` : '',
              config.terminologyToAvoid.length
                ? `Terminology to avoid: ${config.terminologyToAvoid.join(', ')}`
                : '',
              '',
              `Page: ${edit.url}`,
              `Title: ${page.titleTag}`,
              `H1: ${page.h1}`,
              `Existing H2s: ${page.h2s.join(' | ')}`,
              `Page content: ${page.bodyText.slice(0, 6000)}`,
              '',
              `Edit type: ${edit.editType}`,
              `Placement: ${edit.whereOnPage}`,
              `Keywords this edit must cover naturally: ${edit.keywordsTargeted}`,
              '',
              `Outline to turn into publishable copy (its instructions describe what to write; do not copy its phrasing):`,
              edit.suggestedCopy,
            ]
              .filter((line) => line !== '')
              .join('\n'),
          },
        ],
      });

      if (response.stop_reason === 'refusal') return null;
      const text = response.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text' || !text.text.trim()) return null;
      return text.text.trim();
    } catch (err) {
      console.warn(`LLM draft failed for ${edit.url} (${edit.editType}): ${(err as Error).message}`);
      return null;
    }
  }
}
