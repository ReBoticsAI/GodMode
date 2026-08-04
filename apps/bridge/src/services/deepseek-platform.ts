import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for DeepSeek (metered) API key (#231). */
export const DEEPSEEK_API_KEY_SECRET_ID = "deepseek-api-key";
export const DEEPSEEK_API_KEY_SECRET_NAME = "deepseek_api_key";

/** OpenAI-compatible chat base (includes /v1). */
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com/v1";

/**
 * DeepSeek platform chat catalog snapshot (2026-08-03).
 * Legacy deepseek-chat / deepseek-reasoner retired 2026-07-24; use V4 ids.
 * https://api-docs.deepseek.com/
 */
export const DEEPSEEK_CHAT_CATALOG = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
] as const;

export type DeepSeekAuthSource = "env" | "vault" | "none";

export interface DeepSeekAuthStatus {
  connected: boolean;
  source: DeepSeekAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveDeepSeekApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.DEEPSEEK_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: DEEPSEEK_API_KEY_SECRET_ID,
    name: DEEPSEEK_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertDeepSeekApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: DEEPSEEK_API_KEY_SECRET_ID,
    name: DEEPSEEK_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeDeepSeekApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: DEEPSEEK_API_KEY_SECRET_ID,
    name: DEEPSEEK_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getDeepSeekAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): DeepSeekAuthStatus {
  const env = process.env.DEEPSEEK_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: DEEPSEEK_API_KEY_SECRET_ID,
    name: DEEPSEEK_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isDeepSeekPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveDeepSeekApiKey(db, agentId) != null;
}

export function isDeepSeekVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === DEEPSEEK_API_KEY_SECRET_NAME || n === "deepseek-api-key";
}

export function isDeepSeekVaultSecretId(id: string): boolean {
  return (
    id === DEEPSEEK_API_KEY_SECRET_ID ||
    id.startsWith(`${DEEPSEEK_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at DeepSeek transport. */
export function isDeepSeekAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.deepseek === true || config.transport === "deepseek") return true;
  if (config.apiKeyRef === DEEPSEEK_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.deepseek.com");
}
