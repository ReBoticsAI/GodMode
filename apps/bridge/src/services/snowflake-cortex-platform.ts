import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret ids/names for Snowflake Cortex PAT Connect (#355).
 * Stores PAT + Cortex OpenAI-compatible base URL as sibling Platform secrets.
 */
export const SNOWFLAKE_CORTEX_API_KEY_SECRET_ID = "snowflake-cortex-api-key";
export const SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME = "snowflake_cortex_api_key";
export const SNOWFLAKE_CORTEX_BASE_URL_SECRET_ID = "snowflake-cortex-base-url";
export const SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME = "snowflake_cortex_base_url";

/**
 * Snowflake Cortex chat catalog snapshot (2026-08-04).
 * Prefer Chat Completions ids; custom slug allowed.
 * https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api
 */
export const SNOWFLAKE_CORTEX_CHAT_CATALOG = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "llama3.1-70b", label: "Llama 3.1 70B" },
  { id: "mistral-large2", label: "Mistral Large 2" },
  { id: "openai-gpt-4.1", label: "GPT-4.1" },
] as const;

export type SnowflakeCortexAuthSource = "env" | "vault" | "none";

export interface SnowflakeCortexAuthStatus {
  connected: boolean;
  source: SnowflakeCortexAuthSource;
  masked?: string;
  baseUrl?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

/**
 * Normalize operator input to the Cortex OpenAI-compatible root:
 * `https://<account>.snowflakecomputing.com/api/v2/cortex/v1`
 */
export function normalizeSnowflakeCortexBaseUrl(raw: string): string {
  let value = raw.trim().replace(/\/+$/, "");
  if (!value) {
    throw new Error("Snowflake account URL is required");
  }
  if (!/^https?:\/\//i.test(value)) {
    // Account identifier only (e.g. org-account or xy12345.us-east-1)
    value = `https://${value}.snowflakecomputing.com`;
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("Snowflake account URL must start with http:// or https://");
  }
  const lower = value.toLowerCase();
  if (lower.includes("/api/v2/cortex")) {
    return value.replace(/\/+$/, "");
  }
  return `${value.replace(/\/+$/, "")}/api/v2/cortex/v1`;
}

export function resolveSnowflakeCortexApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.SNOWFLAKE_CORTEX_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: SNOWFLAKE_CORTEX_API_KEY_SECRET_ID,
    name: SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function resolveSnowflakeCortexBaseUrl(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.SNOWFLAKE_CORTEX_BASE_URL?.trim();
  if (env) return normalizeSnowflakeCortexBaseUrl(env);
  const value = resolvePlatformVaultSecret(db, {
    baseId: SNOWFLAKE_CORTEX_BASE_URL_SECRET_ID,
    name: SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME,
    agentId,
  });
  return value ? normalizeSnowflakeCortexBaseUrl(value) : null;
}

export function upsertSnowflakeCortexCredential(
  db: AppDatabase,
  apiKey: string,
  accountUrl: string,
  agentId?: string | null
): void {
  const normalized = normalizeSnowflakeCortexBaseUrl(accountUrl);
  upsertPlatformVaultSecret(db, {
    baseId: SNOWFLAKE_CORTEX_API_KEY_SECRET_ID,
    name: SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
  upsertPlatformVaultSecret(db, {
    baseId: SNOWFLAKE_CORTEX_BASE_URL_SECRET_ID,
    name: SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME,
    value: normalized,
    agentId,
  });
}

export function removeSnowflakeCortexCredential(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  const keyRemoved = removePlatformVaultSecret(db, {
    baseId: SNOWFLAKE_CORTEX_API_KEY_SECRET_ID,
    name: SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME,
    agentId,
  });
  const urlRemoved = removePlatformVaultSecret(db, {
    baseId: SNOWFLAKE_CORTEX_BASE_URL_SECRET_ID,
    name: SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME,
    agentId,
  });
  return keyRemoved || urlRemoved;
}

export function getSnowflakeCortexAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): SnowflakeCortexAuthStatus {
  const envKey = process.env.SNOWFLAKE_CORTEX_API_KEY?.trim();
  const envUrl = process.env.SNOWFLAKE_CORTEX_BASE_URL?.trim();
  if (envKey && envUrl) {
    return {
      connected: true,
      source: "env",
      masked: maskKey(envKey),
      baseUrl: normalizeSnowflakeCortexBaseUrl(envUrl),
    };
  }
  const key = getPlatformVaultSecretInScope(db, {
    baseId: SNOWFLAKE_CORTEX_API_KEY_SECRET_ID,
    name: SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME,
    agentId,
  });
  const baseUrl = getPlatformVaultSecretInScope(db, {
    baseId: SNOWFLAKE_CORTEX_BASE_URL_SECRET_ID,
    name: SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME,
    agentId,
  });
  if (key && baseUrl) {
    return {
      connected: true,
      source: "vault",
      masked: maskKey(key),
      baseUrl: normalizeSnowflakeCortexBaseUrl(baseUrl),
    };
  }
  return { connected: false, source: "none" };
}

export function isSnowflakeCortexPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return (
    resolveSnowflakeCortexApiKey(db, agentId) != null &&
    resolveSnowflakeCortexBaseUrl(db, agentId) != null
  );
}

export function isSnowflakeCortexVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === SNOWFLAKE_CORTEX_API_KEY_SECRET_NAME ||
    n === "snowflake-cortex-api-key" ||
    n === SNOWFLAKE_CORTEX_BASE_URL_SECRET_NAME ||
    n === "snowflake-cortex-base-url"
  );
}

export function isSnowflakeCortexVaultSecretId(id: string): boolean {
  return (
    id === SNOWFLAKE_CORTEX_API_KEY_SECRET_ID ||
    id.startsWith(`${SNOWFLAKE_CORTEX_API_KEY_SECRET_ID}__agent__`) ||
    id === SNOWFLAKE_CORTEX_BASE_URL_SECRET_ID ||
    id.startsWith(`${SNOWFLAKE_CORTEX_BASE_URL_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at Snowflake Cortex transport. */
export function isSnowflakeCortexAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.snowflakeCortex === true || config.transport === "snowflake_cortex") {
    return true;
  }
  if (config.apiKeyRef === SNOWFLAKE_CORTEX_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("snowflakecomputing.com") && base.includes("/api/v2/cortex");
}
