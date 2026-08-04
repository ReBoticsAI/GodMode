import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret id/name for MiniMax payg interface key (#231).
 * Distinct from MiniMax Token Plan subscription keys (#230).
 */
export const MINIMAX_API_KEY_SECRET_ID = "minimax-api-key";
export const MINIMAX_API_KEY_SECRET_NAME = "minimax_api_key";

/**
 * OpenAI-compatible chat base.
 * https://platform.minimax.io/docs/api-reference/text-openai-api
 */
export const MINIMAX_API_BASE_URL = "https://api.minimax.io/v1";

/**
 * MiniMax payg chat catalog snapshot (2026-08-03).
 * Custom slug remains on the Vault card.
 */
export const MINIMAX_CHAT_CATALOG = [
  { id: "MiniMax-M3", label: "MiniMax M3" },
  { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
  { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
] as const;

export type MinimaxAuthSource = "env" | "vault" | "none";

export interface MinimaxAuthStatus {
  connected: boolean;
  source: MinimaxAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveMinimaxApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.MINIMAX_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: MINIMAX_API_KEY_SECRET_ID,
    name: MINIMAX_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertMinimaxApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: MINIMAX_API_KEY_SECRET_ID,
    name: MINIMAX_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeMinimaxApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: MINIMAX_API_KEY_SECRET_ID,
    name: MINIMAX_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getMinimaxAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): MinimaxAuthStatus {
  const env = process.env.MINIMAX_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: MINIMAX_API_KEY_SECRET_ID,
    name: MINIMAX_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isMinimaxPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveMinimaxApiKey(db, agentId) != null;
}

export function isMinimaxVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === MINIMAX_API_KEY_SECRET_NAME || n === "minimax-api-key";
}

export function isMinimaxVaultSecretId(id: string): boolean {
  return (
    id === MINIMAX_API_KEY_SECRET_ID ||
    id.startsWith(`${MINIMAX_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at MiniMax payg transport. */
export function isMinimaxAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  // Token Plan uses the same host; exclude via transport / secret / flag.
  if (
    config.minimaxToken === true ||
    config.transport === "minimax_token" ||
    config.apiKeyRef === "minimax-token-api-key"
  ) {
    return false;
  }
  if (config.minimax === true || config.transport === "minimax") return true;
  if (config.apiKeyRef === MINIMAX_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.minimax.io");
}
