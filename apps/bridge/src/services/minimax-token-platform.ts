import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret id/name for MiniMax Token Plan subscription (#230 / #353).
 * Distinct from MiniMax payg interface key (`minimax-api-key`).
 */
export const MINIMAX_TOKEN_API_KEY_SECRET_ID = "minimax-token-api-key";
export const MINIMAX_TOKEN_API_KEY_SECRET_NAME = "minimax_token_api_key";

/**
 * Same OpenAI-compatible host as payg; subscription key (sk-cp-…) is distinct.
 * https://platform.minimax.io/docs/token-plan/other-tools
 */
export const MINIMAX_TOKEN_API_BASE_URL = "https://api.minimax.io/v1";

/**
 * MiniMax Token Plan chat catalog snapshot (2026-08-03).
 * Prefer chat/completions-compatible ids; custom slug allowed.
 */
export const MINIMAX_TOKEN_CHAT_CATALOG = [
  { id: "MiniMax-M3", label: "MiniMax M3" },
  { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
  { id: "MiniMax-M2.5", label: "MiniMax M2.5" },
] as const;

export type MinimaxTokenAuthSource = "env" | "vault" | "none";

export interface MinimaxTokenAuthStatus {
  connected: boolean;
  source: MinimaxTokenAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveMinimaxTokenApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.MINIMAX_TOKEN_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: MINIMAX_TOKEN_API_KEY_SECRET_ID,
    name: MINIMAX_TOKEN_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertMinimaxTokenApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: MINIMAX_TOKEN_API_KEY_SECRET_ID,
    name: MINIMAX_TOKEN_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeMinimaxTokenApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: MINIMAX_TOKEN_API_KEY_SECRET_ID,
    name: MINIMAX_TOKEN_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getMinimaxTokenAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): MinimaxTokenAuthStatus {
  const env = process.env.MINIMAX_TOKEN_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: MINIMAX_TOKEN_API_KEY_SECRET_ID,
    name: MINIMAX_TOKEN_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isMinimaxTokenPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveMinimaxTokenApiKey(db, agentId) != null;
}

export function isMinimaxTokenVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === MINIMAX_TOKEN_API_KEY_SECRET_NAME || n === "minimax-token-api-key";
}

export function isMinimaxTokenVaultSecretId(id: string): boolean {
  return (
    id === MINIMAX_TOKEN_API_KEY_SECRET_ID ||
    id.startsWith(`${MINIMAX_TOKEN_API_KEY_SECRET_ID}__agent__`)
  );
}

/**
 * True when agent config points at MiniMax Token Plan transport.
 * Distinguishes from payg via transport flag / secret id (same host URL).
 */
export function isMinimaxTokenAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.minimaxToken === true || config.transport === "minimax_token") {
    return true;
  }
  if (config.apiKeyRef === MINIMAX_TOKEN_API_KEY_SECRET_ID) return true;
  return false;
}
