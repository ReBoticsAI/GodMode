import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret id/name for Kimi Code membership (#230 / #353).
 * Distinct from Moonshot / Kimi Open Platform payg and hosted Kimi routes.
 */
export const KIMI_CODE_API_KEY_SECRET_ID = "kimi-code-api-key";
export const KIMI_CODE_API_KEY_SECRET_NAME = "kimi_code_api_key";

/**
 * Kimi Code OpenAI-compatible coding base (subscription).
 * https://www.kimi.com/code/docs/en/
 */
export const KIMI_CODE_API_BASE_URL = "https://api.kimi.com/coding/v1";

/**
 * Kimi Code chat catalog snapshot (2026-08-03).
 * Prefer chat/completions-compatible ids; custom slug allowed.
 */
export const KIMI_CODE_CHAT_CATALOG = [
  { id: "k3", label: "Kimi K3" },
  { id: "k3-256k", label: "Kimi K3 256K" },
  { id: "kimi-for-coding", label: "Kimi for Coding" },
  { id: "kimi-for-coding-highspeed", label: "Kimi for Coding HighSpeed" },
] as const;

export type KimiCodeAuthSource = "env" | "vault" | "none";

export interface KimiCodeAuthStatus {
  connected: boolean;
  source: KimiCodeAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveKimiCodeApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.KIMI_CODE_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: KIMI_CODE_API_KEY_SECRET_ID,
    name: KIMI_CODE_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertKimiCodeApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: KIMI_CODE_API_KEY_SECRET_ID,
    name: KIMI_CODE_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeKimiCodeApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: KIMI_CODE_API_KEY_SECRET_ID,
    name: KIMI_CODE_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getKimiCodeAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): KimiCodeAuthStatus {
  const env = process.env.KIMI_CODE_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: KIMI_CODE_API_KEY_SECRET_ID,
    name: KIMI_CODE_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isKimiCodePlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveKimiCodeApiKey(db, agentId) != null;
}

export function isKimiCodeVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === KIMI_CODE_API_KEY_SECRET_NAME || n === "kimi-code-api-key";
}

export function isKimiCodeVaultSecretId(id: string): boolean {
  return (
    id === KIMI_CODE_API_KEY_SECRET_ID ||
    id.startsWith(`${KIMI_CODE_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at Kimi Code transport. */
export function isKimiCodeAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.kimiCode === true || config.transport === "kimi_code") return true;
  if (config.apiKeyRef === KIMI_CODE_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.kimi.com/coding");
}
