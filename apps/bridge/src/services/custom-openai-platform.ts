import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret ids/names for custom OpenAI-compatible escape hatch (#231).
 * Stores API key + base URL as sibling Platform secrets.
 */
export const CUSTOM_OPENAI_API_KEY_SECRET_ID = "custom-openai-api-key";
export const CUSTOM_OPENAI_API_KEY_SECRET_NAME = "custom_openai_api_key";
export const CUSTOM_OPENAI_BASE_URL_SECRET_ID = "custom-openai-base-url";
export const CUSTOM_OPENAI_BASE_URL_SECRET_NAME = "custom_openai_base_url";

export type CustomOpenAiAuthSource = "env" | "vault" | "none";

export interface CustomOpenAiAuthStatus {
  connected: boolean;
  source: CustomOpenAiAuthSource;
  masked?: string;
  baseUrl?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function resolveCustomOpenAiApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.CUSTOM_OPENAI_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: CUSTOM_OPENAI_API_KEY_SECRET_ID,
    name: CUSTOM_OPENAI_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function resolveCustomOpenAiBaseUrl(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.CUSTOM_OPENAI_BASE_URL?.trim();
  if (env) return normalizeBaseUrl(env);
  const value = resolvePlatformVaultSecret(db, {
    baseId: CUSTOM_OPENAI_BASE_URL_SECRET_ID,
    name: CUSTOM_OPENAI_BASE_URL_SECRET_NAME,
    agentId,
  });
  return value ? normalizeBaseUrl(value) : null;
}

export function upsertCustomOpenAiCredential(
  db: AppDatabase,
  apiKey: string,
  baseUrl: string,
  agentId?: string | null
): void {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("Base URL is required for custom OpenAI-compatible endpoints");
  }
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error("Base URL must start with http:// or https://");
  }
  upsertPlatformVaultSecret(db, {
    baseId: CUSTOM_OPENAI_API_KEY_SECRET_ID,
    name: CUSTOM_OPENAI_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
  upsertPlatformVaultSecret(db, {
    baseId: CUSTOM_OPENAI_BASE_URL_SECRET_ID,
    name: CUSTOM_OPENAI_BASE_URL_SECRET_NAME,
    value: normalized,
    agentId,
  });
}

export function removeCustomOpenAiCredential(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  const keyRemoved = removePlatformVaultSecret(db, {
    baseId: CUSTOM_OPENAI_API_KEY_SECRET_ID,
    name: CUSTOM_OPENAI_API_KEY_SECRET_NAME,
    agentId,
  });
  const urlRemoved = removePlatformVaultSecret(db, {
    baseId: CUSTOM_OPENAI_BASE_URL_SECRET_ID,
    name: CUSTOM_OPENAI_BASE_URL_SECRET_NAME,
    agentId,
  });
  return keyRemoved || urlRemoved;
}

export function getCustomOpenAiAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): CustomOpenAiAuthStatus {
  const envKey = process.env.CUSTOM_OPENAI_API_KEY?.trim();
  const envUrl = process.env.CUSTOM_OPENAI_BASE_URL?.trim();
  if (envKey && envUrl) {
    return {
      connected: true,
      source: "env",
      masked: maskKey(envKey),
      baseUrl: normalizeBaseUrl(envUrl),
    };
  }
  const key = getPlatformVaultSecretInScope(db, {
    baseId: CUSTOM_OPENAI_API_KEY_SECRET_ID,
    name: CUSTOM_OPENAI_API_KEY_SECRET_NAME,
    agentId,
  });
  const baseUrl = getPlatformVaultSecretInScope(db, {
    baseId: CUSTOM_OPENAI_BASE_URL_SECRET_ID,
    name: CUSTOM_OPENAI_BASE_URL_SECRET_NAME,
    agentId,
  });
  if (key && baseUrl) {
    return {
      connected: true,
      source: "vault",
      masked: maskKey(key),
      baseUrl: normalizeBaseUrl(baseUrl),
    };
  }
  return { connected: false, source: "none" };
}

export function isCustomOpenAiPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return (
    resolveCustomOpenAiApiKey(db, agentId) != null &&
    resolveCustomOpenAiBaseUrl(db, agentId) != null
  );
}

export function isCustomOpenAiVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === CUSTOM_OPENAI_API_KEY_SECRET_NAME ||
    n === "custom-openai-api-key" ||
    n === CUSTOM_OPENAI_BASE_URL_SECRET_NAME ||
    n === "custom-openai-base-url"
  );
}

export function isCustomOpenAiVaultSecretId(id: string): boolean {
  return (
    id === CUSTOM_OPENAI_API_KEY_SECRET_ID ||
    id.startsWith(`${CUSTOM_OPENAI_API_KEY_SECRET_ID}__agent__`) ||
    id === CUSTOM_OPENAI_BASE_URL_SECRET_ID ||
    id.startsWith(`${CUSTOM_OPENAI_BASE_URL_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at custom OpenAI-compatible transport. */
export function isCustomOpenAiAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.customOpenai === true || config.transport === "custom_openai") {
    return true;
  }
  return config.apiKeyRef === CUSTOM_OPENAI_API_KEY_SECRET_ID;
}
