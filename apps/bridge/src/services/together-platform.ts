import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for Together AI (metered) API key (#231). */
export const TOGETHER_API_KEY_SECRET_ID = "together-api-key";
export const TOGETHER_API_KEY_SECRET_NAME = "together_api_key";

/** OpenAI-compatible chat base (includes /v1). */
export const TOGETHER_API_BASE_URL = "https://api.together.ai/v1";

/**
 * Together serverless chat catalog snapshot (2026-08-03).
 * Prefer function-calling chat models; custom slug remains on the Vault card.
 * https://docs.together.ai/docs/serverless-models
 */
export const TOGETHER_CHAT_CATALOG = [
  { id: "MiniMaxAI/MiniMax-M3", label: "MiniMax M3" },
  {
    id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    label: "Llama 3.3 70B Instruct Turbo",
  },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "deepseek-ai/DeepSeek-V4-Pro", label: "DeepSeek V4 Pro" },
  { id: "moonshotai/Kimi-K3", label: "Kimi K3" },
  { id: "Qwen/Qwen3.5-9B", label: "Qwen3.5 9B" },
] as const;

export type TogetherAuthSource = "env" | "vault" | "none";

export interface TogetherAuthStatus {
  connected: boolean;
  source: TogetherAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveTogetherApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.TOGETHER_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: TOGETHER_API_KEY_SECRET_ID,
    name: TOGETHER_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertTogetherApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: TOGETHER_API_KEY_SECRET_ID,
    name: TOGETHER_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeTogetherApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: TOGETHER_API_KEY_SECRET_ID,
    name: TOGETHER_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getTogetherAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): TogetherAuthStatus {
  const env = process.env.TOGETHER_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: TOGETHER_API_KEY_SECRET_ID,
    name: TOGETHER_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isTogetherPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveTogetherApiKey(db, agentId) != null;
}

export function isTogetherVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === TOGETHER_API_KEY_SECRET_NAME || n === "together-api-key";
}

export function isTogetherVaultSecretId(id: string): boolean {
  return (
    id === TOGETHER_API_KEY_SECRET_ID ||
    id.startsWith(`${TOGETHER_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at Together transport. */
export function isTogetherAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.together === true || config.transport === "together") return true;
  if (config.apiKeyRef === TOGETHER_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.together.ai") || base.includes("api.together.xyz");
}
