import fs from "fs";
import path from "path";
import { DATA_DIR, getAppConfig } from "./config";
import { loadAdminConfig } from "./sheets";
import type { ActionResult } from "./adminActions";
import type { ClientRow } from "./types";

/**
 * AI visibility: ask the assistants people actually use ("Who are the best IT
 * support companies in Leeds?") and record whether the client is part of the
 * answer. Six platforms: ChatGPT, Claude, Gemini and Perplexity through their
 * own APIs with web search on; Google AI Overview and Copilot through SerpApi.
 * Platforms without a configured key are skipped, not failed.
 *
 * Per prompt and platform the client is either:
 *   - "answer": named in the answer text itself (logo shows in full colour)
 *   - "source": only cited as a source (logo greyed out)
 *   - "absent": not present at all (logo hidden)
 * Runs are stored on the data volume, so every prompt builds a history.
 */

export type AiPlatform = "chatgpt" | "claude" | "gemini" | "perplexity" | "ai_overview" | "copilot";

export const AI_PLATFORMS: Array<{ id: AiPlatform; label: string; logo: string }> = [
  { id: "chatgpt", label: "ChatGPT", logo: "/ai/chatgpt.svg" },
  { id: "claude", label: "Claude", logo: "/ai/claude.svg" },
  { id: "gemini", label: "Gemini", logo: "/ai/gemini.svg" },
  { id: "perplexity", label: "Perplexity", logo: "/ai/perplexity.svg" },
  { id: "ai_overview", label: "Google AI Overview", logo: "/ai/google.svg" },
  { id: "copilot", label: "Copilot", logo: "/ai/copilot.svg" },
];

export type MentionStatus = "answer" | "source" | "absent" | "error" | "not_configured";

export interface AiPromptResult {
  platform: AiPlatform;
  status: MentionStatus;
  /** the sentence(s) around the client's mention, or the answer opening */
  snippet?: string;
  citedDomains?: string[];
  error?: string;
}

export interface AiVisibilityRun {
  clientKey: string;
  ranAt: string;
  prompts: Array<{ promptKey: string; prompt: string; results: AiPromptResult[] }>;
}

/** What a report embeds: the latest run plus per-prompt history. */
export interface AiVisibilityReport {
  ranAt: string;
  platforms: Array<{ id: AiPlatform; label: string; logo: string }>;
  prompts: Array<{
    promptKey: string;
    prompt: string;
    results: AiPromptResult[];
    history: Array<{ date: string; statuses: Partial<Record<AiPlatform, MentionStatus>> }>;
  }>;
}

// ---------------------------------------------------------------------------
// Mention detection
// ---------------------------------------------------------------------------

function brandTerms(client: ClientRow): string[] {
  const name = client.client_name.trim();
  const domain = client.domain.toLowerCase().replace(/^www\./, "");
  const terms = new Set<string>([name.toLowerCase(), domain]);
  // "AAG IT Services" should also match plain "AAG"; skip short/generic words.
  const first = name.split(/\s+/)[0];
  if (first.length >= 3 && !/^(the|best|top)$/i.test(first)) terms.add(first.toLowerCase());
  return [...terms];
}

function domainCited(urls: string[], client: ClientRow): boolean {
  const domain = client.domain.toLowerCase().replace(/^www\./, "");
  return urls.some((u) => {
    try {
      return new URL(u).hostname.toLowerCase().replace(/^www\./, "").endsWith(domain);
    } catch {
      return u.toLowerCase().includes(domain);
    }
  });
}

/** Snippet around the first brand mention (or the answer opening). */
export function mentionSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i >= 0) {
      const start = Math.max(0, lower.lastIndexOf(".", i) + 1);
      const end = lower.indexOf(".", i + term.length);
      return text.slice(start, end === -1 ? Math.min(text.length, i + 220) : end + 1).trim().slice(0, 320);
    }
  }
  return text.trim().slice(0, 220);
}

export function classifyMention(
  answerText: string,
  citedUrls: string[],
  client: ClientRow,
): { status: "answer" | "source" | "absent"; snippet?: string; citedDomains: string[] } {
  const terms = brandTerms(client);
  const lower = answerText.toLowerCase();
  const inAnswer = terms.some((t) => lower.includes(t.toLowerCase()));
  const inSources = domainCited(citedUrls, client);
  const citedDomains = [...new Set(citedUrls.map((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u.slice(0, 60);
    }
  }))].slice(0, 12);
  if (inAnswer) return { status: "answer", snippet: mentionSnippet(answerText, terms), citedDomains };
  if (inSources) return { status: "source", snippet: mentionSnippet(answerText, terms), citedDomains };
  return { status: "absent", snippet: answerText.trim().slice(0, 160), citedDomains };
}

// ---------------------------------------------------------------------------
// Providers — each returns the answer text + cited URLs
// ---------------------------------------------------------------------------

interface ProviderAnswer {
  text: string;
  citations: string[];
}

const TIMEOUT_MS = 90_000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function jsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} said ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Pull every http(s) URL out of a nested structure (for defensive parsing). */
function urlsDeep(value: unknown, out: Set<string> = new Set(), depth = 0): string[] {
  if (depth > 8 || out.size > 100) return [...out];
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) urlsDeep(v, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) urlsDeep(v, out, depth + 1);
  }
  return [...out];
}

function textDeep(value: unknown, keys: string[], out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 60) return out;
  if (Array.isArray(value)) {
    for (const v of value) textDeep(v, keys, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k) && typeof v === "string" && v.trim().length > 0) out.push(v);
      else textDeep(v, keys, out, depth + 1);
    }
  }
  return out;
}

async function askChatGpt(prompt: string): Promise<ProviderAnswer> {
  const { openAiApiKey } = getAppConfig();
  const model = process.env.AI_VIS_OPENAI_MODEL || "gpt-5-mini";
  const res = await timedFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiApiKey}` },
    body: JSON.stringify({ model, input: prompt, tools: [{ type: "web_search" }], reasoning: { effort: "low" } }),
  });
  const body = await jsonOrThrow(res, "OpenAI");
  const text =
    (typeof body.output_text === "string" && body.output_text) ||
    textDeep(body.output, ["text"]).join("\n");
  const citations = urlsDeep(body.output);
  if (!text) throw new Error("OpenAI returned no answer text");
  return { text, citations };
}

async function askClaude(prompt: string): Promise<ProviderAnswer> {
  const { anthropicApiKey } = getAppConfig();
  const model = process.env.AI_VIS_ANTHROPIC_MODEL || "claude-sonnet-5";
  const res = await timedFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    }),
  });
  const body = await jsonOrThrow(res, "Anthropic");
  const blocks = Array.isArray(body.content) ? body.content : [];
  const text = blocks
    .filter((b: Record<string, unknown>) => b.type === "text")
    .map((b: Record<string, unknown>) => String(b.text ?? ""))
    .join("\n");
  const citations = urlsDeep(blocks);
  if (!text) throw new Error("Anthropic returned no answer text");
  return { text, citations };
}

async function askGemini(prompt: string): Promise<ProviderAnswer> {
  const { geminiApiKey } = getAppConfig();
  const model = process.env.AI_VIS_GEMINI_MODEL || "gemini-2.5-flash";
  const res = await timedFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    },
  );
  const body = await jsonOrThrow(res, "Gemini");
  const candidates = body.candidates as Array<Record<string, unknown>> | undefined;
  const text = textDeep(candidates?.[0]?.content, ["text"]).join("\n");
  const citations = urlsDeep(candidates?.[0]);
  if (!text) throw new Error("Gemini returned no answer text");
  return { text, citations };
}

async function askPerplexity(prompt: string): Promise<ProviderAnswer> {
  const { perplexityApiKey } = getAppConfig();
  const model = process.env.AI_VIS_PERPLEXITY_MODEL || "sonar";
  const res = await timedFetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${perplexityApiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  });
  const body = await jsonOrThrow(res, "Perplexity");
  const choices = body.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const text = String(message?.content ?? "");
  const citations = [
    ...(Array.isArray(body.citations) ? (body.citations as string[]) : []),
    ...urlsDeep(body.search_results),
  ];
  if (!text) throw new Error("Perplexity returned no answer text");
  return { text, citations };
}

async function serpApi(params: Record<string, string>): Promise<Record<string, unknown>> {
  const { serpApiKey } = getAppConfig();
  const qs = new URLSearchParams({ ...params, api_key: serpApiKey ?? "" });
  const res = await timedFetch(`https://serpapi.com/search.json?${qs}`, { method: "GET" });
  return jsonOrThrow(res, "SerpApi");
}

async function askAiOverview(prompt: string): Promise<ProviderAnswer> {
  // The AI Overview arrives embedded in a Google search; when only a token is
  // returned, a second call to the dedicated engine fetches the full block.
  const search = await serpApi({ engine: "google", q: prompt, hl: "en", gl: "uk", location: "United Kingdom" });
  let overview = search.ai_overview as Record<string, unknown> | undefined;
  if (overview?.page_token && !overview.text_blocks) {
    overview = (await serpApi({
      engine: "google_ai_overview",
      page_token: String(overview.page_token),
    })).ai_overview as Record<string, unknown> | undefined;
  }
  if (!overview || (!overview.text_blocks && !overview.answer)) {
    return { text: "", citations: [] }; // no AI Overview shown for this query — a real "absent"
  }
  const text = textDeep(overview, ["snippet", "answer", "title", "text"]).join("\n");
  const citations = urlsDeep(overview.references ?? overview);
  return { text, citations };
}

async function askCopilot(prompt: string): Promise<ProviderAnswer> {
  const body = await serpApi({ engine: "bing_copilot", q: prompt });
  const text = textDeep(body.answer ?? body.results ?? body, ["text", "snippet", "answer", "content"]).join("\n");
  const citations = urlsDeep(body);
  if (!text) throw new Error("Copilot returned no answer text");
  return { text, citations };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function configuredPlatforms(): Partial<Record<AiPlatform, (p: string) => Promise<ProviderAnswer>>> {
  const app = getAppConfig();
  const map: Partial<Record<AiPlatform, (p: string) => Promise<ProviderAnswer>>> = {};
  if (app.openAiApiKey) map.chatgpt = askChatGpt;
  if (app.anthropicApiKey) map.claude = askClaude;
  if (app.geminiApiKey) map.gemini = askGemini;
  if (app.perplexityApiKey) map.perplexity = askPerplexity;
  if (app.serpApiKey) {
    map.ai_overview = askAiOverview;
    map.copilot = askCopilot;
  }
  return map;
}

export function aiPlatformAvailability(): Record<AiPlatform, boolean> {
  const configured = configuredPlatforms();
  return Object.fromEntries(AI_PLATFORMS.map((p) => [p.id, Boolean(configured[p.id])])) as Record<
    AiPlatform,
    boolean
  >;
}

const RUNS_DIR = (clientKey: string) => path.join(DATA_DIR, "aivis", clientKey);
const SAFE = /^[a-z0-9_-]+$/i;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Background runs (a full run is minutes of live queries — far longer than an
// HTTP request survives behind the proxy — so POST starts it and GET polls)
// ---------------------------------------------------------------------------

export interface RunProgress {
  startedAt: string;
  total: number;
  done: number;
  finished: boolean;
  ok?: boolean;
  message?: string;
  /** last time the run made progress (detects runs killed by a restart) */
  updatedAt?: string;
}

const activeRuns = new Map<string, RunProgress>();
const PROGRESS_FILE = (clientKey: string) => path.join(DATA_DIR, "aivis", clientKey, ".progress.json");
const STALL_MS = 4 * 60_000;

function persistProgress(clientKey: string, progress: RunProgress): void {
  try {
    progress.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(PROGRESS_FILE(clientKey)), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE(clientKey), JSON.stringify(progress));
  } catch {
    // progress display is best-effort
  }
}

export function aiVisibilityProgress(clientKey: string): RunProgress | null {
  const live = activeRuns.get(clientKey);
  if (live) return live;
  if (!SAFE.test(clientKey)) return null;
  // No run in this process: a file left unfinished means a deploy or restart
  // killed it mid-flight — say so instead of showing "running" forever.
  try {
    const stored = JSON.parse(fs.readFileSync(PROGRESS_FILE(clientKey), "utf8")) as RunProgress;
    if (!stored.finished) {
      const last = Date.parse(stored.updatedAt ?? stored.startedAt);
      if (Date.now() - last > STALL_MS) {
        return {
          ...stored,
          finished: true,
          ok: false,
          message: `Run interrupted after ${stored.done}/${stored.total} queries (the server restarted, likely a deploy). Run it again.`,
        };
      }
    }
    return stored;
  } catch {
    return null;
  }
}

export function startAiVisibilityRun(clientKey: string): ActionResult {
  const existing = activeRuns.get(clientKey);
  if (existing && !existing.finished) {
    return { ok: true, message: `Already running (${existing.done}/${existing.total} queries done).` };
  }
  const progress: RunProgress = { startedAt: new Date().toISOString(), total: 0, done: 0, finished: false };
  activeRuns.set(clientKey, progress);
  persistProgress(clientKey, progress);
  runAiVisibility(clientKey, () => {}, progress)
    .then((result) => {
      progress.finished = true;
      progress.ok = result.ok;
      progress.message = result.message;
      persistProgress(clientKey, progress);
    })
    .catch((error) => {
      progress.finished = true;
      progress.ok = false;
      progress.message = error instanceof Error ? error.message : "Run failed.";
      persistProgress(clientKey, progress);
    });
  return { ok: true, message: "Run started — this takes a few minutes, progress shows below." };
}

export async function runAiVisibility(
  clientKey: string,
  log: (message: string) => void = () => {},
  progress?: RunProgress,
): Promise<ActionResult & { run?: AiVisibilityRun }> {
  if (!SAFE.test(clientKey)) return { ok: false, message: "Bad client key." };
  const { config } = await loadAdminConfig();
  const client = config.clients.find((c) => c.client_key === clientKey);
  if (!client) return { ok: false, message: "Unknown client." };

  const prompts = config.aiSearchPrompts.filter((p) => p.client_key === clientKey && p.active);
  if (prompts.length === 0) {
    return { ok: false, message: "No AI search prompts configured for this client yet." };
  }
  const providers = configuredPlatforms();
  const active = AI_PLATFORMS.filter((p) => providers[p.id]);
  if (active.length === 0) {
    return { ok: false, message: "No AI platform keys configured (OPEN_AI_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, SERPAPI_KEY, ANTHROPIC_API_KEY)." };
  }

  const jobs = prompts.flatMap((prompt) =>
    AI_PLATFORMS.map((platform) => ({ prompt, platform: platform.id })),
  );
  if (progress) {
    progress.total = jobs.length;
    persistProgress(clientKey, progress);
  }
  log(`AI visibility: ${prompts.length} prompts x ${active.length} platforms...`);

  const cells = await mapLimit(jobs, 10, async ({ prompt, platform }): Promise<[string, AiPromptResult]> => {
    try {
      const provider = providers[platform];
      if (!provider) return [prompt.prompt_key, { platform, status: "not_configured" }];
      const answer = await provider(prompt.prompt);
      if (answer.text.trim() === "" && platform === "ai_overview") {
        return [prompt.prompt_key, { platform, status: "absent", snippet: "No AI Overview shown for this search." }];
      }
      const classified = classifyMention(answer.text, answer.citations, client);
      return [prompt.prompt_key, { platform, ...classified }];
    } catch (error) {
      return [
        prompt.prompt_key,
        { platform, status: "error", error: error instanceof Error ? error.message.slice(0, 200) : "failed" },
      ];
    } finally {
      if (progress) {
        progress.done += 1;
        if (progress.done % 5 === 0 || progress.done === progress.total) persistProgress(clientKey, progress);
      }
    }
  });

  const byPrompt = new Map<string, AiPromptResult[]>();
  for (const [key, result] of cells) {
    byPrompt.set(key, [...(byPrompt.get(key) ?? []), result]);
  }
  const run: AiVisibilityRun = {
    clientKey,
    ranAt: new Date().toISOString(),
    prompts: prompts.map((p) => ({
      promptKey: p.prompt_key,
      prompt: p.prompt,
      results: byPrompt.get(p.prompt_key) ?? [],
    })),
  };

  fs.mkdirSync(RUNS_DIR(clientKey), { recursive: true });
  const file = path.join(RUNS_DIR(clientKey), `${run.ranAt.slice(0, 19).replace(/[:T]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2));

  const errors = cells.filter(([, r]) => r.status === "error").length;
  const answers = cells.filter(([, r]) => r.status === "answer").length;
  log(`AI visibility run stored (${answers} answer mentions, ${errors} errors).`);
  return {
    ok: true,
    message: `Ran ${prompts.length} prompts across ${active.length} platforms: ${answers} full-colour mentions${errors > 0 ? `, ${errors} queries errored` : ""}.`,
    run,
  };
}

// ---------------------------------------------------------------------------
// History / report assembly
// ---------------------------------------------------------------------------

export function listAiVisibilityRuns(clientKey: string): AiVisibilityRun[] {
  if (!SAFE.test(clientKey)) return [];
  const dir = RUNS_DIR(clientKey);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AiVisibilityRun;
      } catch {
        return null;
      }
    })
    .filter((r): r is AiVisibilityRun => r !== null);
}

/** Latest run + per-prompt history, in the shape the report embeds. */
export function buildAiVisibilityReport(clientKey: string): AiVisibilityReport | null {
  const runs = listAiVisibilityRuns(clientKey);
  const latest = runs[runs.length - 1];
  if (!latest) return null;
  return {
    ranAt: latest.ranAt,
    platforms: AI_PLATFORMS,
    prompts: latest.prompts.map((p) => ({
      ...p,
      history: runs
        .map((run) => {
          const match = run.prompts.find((rp) => rp.promptKey === p.promptKey);
          if (!match) return null;
          const statuses: Partial<Record<AiPlatform, MentionStatus>> = {};
          for (const r of match.results) statuses[r.platform] = r.status;
          return { date: run.ranAt.slice(0, 10), statuses };
        })
        .filter((h): h is { date: string; statuses: Partial<Record<AiPlatform, MentionStatus>> } => h !== null),
    })),
  };
}
