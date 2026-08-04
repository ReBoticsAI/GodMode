import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret id/name for Poe subscription compute points (#230 / #353).
 * Per-tenant keys only; points deduct from the key owner's Poe account.
 */
export const POE_API_KEY_SECRET_ID = "poe-api-key";
export const POE_API_KEY_SECRET_NAME = "poe_api_key";

/**
 * Poe OpenAI-compatible API base (subscription points).
 * https://creator.poe.com/docs/external-applications/openai-compatible-api
 */
export const POE_API_BASE_URL = "https://api.poe.com/v1";

/**
 * Poe chat catalog snapshot (2026-08-03).
 * Prefer chat/completions-compatible bot ids; custom slug allowed.
 */
export const POE_CHAT_CATALOG = [
  { id: "Claude-Sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "GPT-4o", label: "GPT-4o" },
  { id: "Gemini-2.5-Pro", label: "Gemini 2.5 Pro" },
  { id: "Llama-3.1-405B", label: "Llama 3.1 405B" },
] as const;

export type PoeAuthSource = "env" | "vault" | "none";

export interface PoeAuthStatus {
  connected: boolean;
  source: PoeAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolvePoeApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.POE_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: POE_API_KEY_SECRET_ID,
    name: POE_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertPoeApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: POE_API_KEY_SECRET_ID,
    name: POE_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removePoeApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: POE_API_KEY_SECRET_ID,
    name: POE_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getPoeAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): PoeAuthStatus {
  const env = process.env.POE_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: POE_API_KEY_SECRET_ID,
    name: POE_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isPoePlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolvePoeApiKey(db, agentId) != null;
}

export function isPoeVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === POE_API_KEY_SECRET_NAME || n === "poe-api-key";
}

export function isPoeVaultSecretId(id: string): boolean {
  return (
    id === POE_API_KEY_SECRET_ID ||
    id.startsWith(`${POE_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at Poe transport. */
export function isPoeAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.poe === true || config.transport === "poe") return true;
  if (config.apiKeyRef === POE_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.poe.com");
}
