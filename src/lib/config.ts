import path from "path";
import fs from "fs";

/**
 * Environment / runtime configuration.
 *
 * The app must never hard-fail because credentials are missing: every consumer
 * checks the has* flags and falls back to mock data, making the mock/live
 * boundary explicit in the snapshot's `dataSource` field.
 */

export const ROOT_DIR = process.cwd();
/**
 * Where the app keeps everything it saves (config database, report snapshots,
 * published copies, ranking imports). Defaults to ./data in the repo; on a
 * host, set DATA_DIR to the mounted persistent volume (the start script seeds
 * it from the bundled ./data on first boot).
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, "data");
export const MOCK_DIR = path.join(DATA_DIR, "mock");
export const REPORTS_DIR = path.join(DATA_DIR, "reports");
export const RANKINGS_DIR = path.join(DATA_DIR, "rankings");
/** The app's built-in config database (default storage backend). */
export const DB_FILE = path.join(DATA_DIR, "db", "config.json");

export interface AppConfig {
  googleSheetId: string | null;
  hasGoogleCredentials: boolean;
  hasSheets: boolean;
  /**
   * Where client/report configuration lives. "local" (default): the app's
   * own JSON database at data/db/config.json. "sheets": a Google Sheet
   * (opt-in via CONFIG_BACKEND=sheets, for teams who want bulk spreadsheet
   * editing). GSC credentials are independent of this — they're the data
   * source either way.
   */
  configBackend: "local" | "sheets";
  seRankingApiKey: string | null;
  openAiApiKey: string | null;
  perplexityApiKey: string | null;
  geminiApiKey: string | null;
  serpApiKey: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string;
  /** Model for report commentary — the writing quality matters most here,
   * so it runs on Claude's top model while bulk drafting stays on Opus. */
  anthropicCommentaryModel: string;
  enableLlmCommentary: boolean;
  commentaryMode: "rules_only" | "llm_draft";
  appUrl: string;
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

export function hasGoogleCredentials(): boolean {
  const inlineJson = readEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (inlineJson) return true;
  const credsPath = readEnv("GOOGLE_APPLICATION_CREDENTIALS");
  if (credsPath && fs.existsSync(credsPath)) return true;
  // OAuth refresh-token flow (for GSC properties that can't add a service account)
  return Boolean(
    readEnv("GOOGLE_OAUTH_CLIENT_ID") &&
      readEnv("GOOGLE_OAUTH_CLIENT_SECRET") &&
      readEnv("GOOGLE_OAUTH_REFRESH_TOKEN"),
  );
}

export function getAppConfig(): AppConfig {
  const googleSheetId = readEnv("GOOGLE_SHEET_ID");
  const hasCreds = hasGoogleCredentials();
  const anthropicApiKey = readEnv("ANTHROPIC_API_KEY");
  // LLM commentary is on by default whenever an API key exists; set
  // ENABLE_LLM_COMMENTARY=false (or COMMENTARY_MODE=rules_only) to opt out.
  const enableLlm = readEnv("ENABLE_LLM_COMMENTARY") !== "false" && Boolean(anthropicApiKey);

  const requestedMode = readEnv("COMMENTARY_MODE");
  let commentaryMode: "rules_only" | "llm_draft" = "rules_only";
  if (enableLlm) {
    commentaryMode = requestedMode === "rules_only" ? "rules_only" : "llm_draft";
  }

  const hasSheets = Boolean(googleSheetId && hasCreds);
  return {
    googleSheetId,
    hasGoogleCredentials: hasCreds,
    hasSheets,
    configBackend: readEnv("CONFIG_BACKEND") === "sheets" && hasSheets ? "sheets" : "local",
    seRankingApiKey: readEnv("SERANKING_API_KEY"),
    // AI visibility providers (all optional — platforms without a key are skipped)
    openAiApiKey: readEnv("OPEN_AI_API_KEY") ?? readEnv("OPENAI_API_KEY"),
    perplexityApiKey: readEnv("PERPLEXITY_API_KEY"),
    geminiApiKey: readEnv("GEMINI_API_KEY"),
    serpApiKey: readEnv("SERPAPI_KEY") ?? readEnv("SERPAPI_API_KEY") ?? readEnv("SERP_API_KEY"),
    anthropicApiKey,
    anthropicModel: readEnv("ANTHROPIC_MODEL") ?? "claude-opus-5",
    anthropicCommentaryModel: readEnv("ANTHROPIC_COMMENTARY_MODEL") ?? "claude-fable-5",
    enableLlmCommentary: enableLlm,
    commentaryMode,
    appUrl: readEnv("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  };
}
