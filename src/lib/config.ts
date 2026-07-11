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
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const MOCK_DIR = path.join(DATA_DIR, "mock");
export const REPORTS_DIR = path.join(DATA_DIR, "reports");
export const RANKINGS_DIR = path.join(DATA_DIR, "rankings");

export interface AppConfig {
  googleSheetId: string | null;
  hasGoogleCredentials: boolean;
  hasSheets: boolean;
  seRankingApiKey: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string;
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
  const enableLlm = readEnv("ENABLE_LLM_COMMENTARY") === "true";

  // Default behaviour: rules_only unless explicitly enabled AND a key exists.
  const requestedMode = readEnv("COMMENTARY_MODE");
  let commentaryMode: "rules_only" | "llm_draft" = "rules_only";
  if (enableLlm && anthropicApiKey) {
    commentaryMode = requestedMode === "rules_only" ? "rules_only" : "llm_draft";
  }

  return {
    googleSheetId,
    hasGoogleCredentials: hasCreds,
    hasSheets: Boolean(googleSheetId && hasCreds),
    seRankingApiKey: readEnv("SERANKING_API_KEY"),
    anthropicApiKey,
    anthropicModel: readEnv("ANTHROPIC_MODEL") ?? "claude-opus-4-8",
    enableLlmCommentary: enableLlm,
    commentaryMode,
    appUrl: readEnv("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  };
}
