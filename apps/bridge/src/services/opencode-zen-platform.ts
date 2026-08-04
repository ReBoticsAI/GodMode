import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for OpenCode Zen (#230 / #354). Distinct from OpenCode Go. */
export const OPENCODE_ZEN_API_KEY_SECRET_ID = "opencode-zen-api-key";
export const OPENCODE_ZEN_API_KEY_SECRET_NAME = "opencode_zen_api_key";

/**
 * OpenCode Zen OpenAI-compatible base.
 * https://opencode.ai/docs/zen/
 * Prefer chat/completions-compatible model ids on this base.
 */
export const OPENCODE_ZEN_API_BASE_URL = "https://opencode.ai/zen/v1";

/**
 * OpenCode Zen chat catalog snapshot (2026-08-03).
 * Prefer chat/completions-compatible ids; custom slug allowed.
 */
export const OPENCODE_ZEN_CHAT_CATALOG = [
  { id: "kimi-k3", label: "Kimi K3" },
  { id: "glm-5.2", label: "GLM-5.2" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "minimax-m3", label: "MiniMax M3" },
] as const;

export type OpencodeZenAuthSource = "env" | "vault" | "none";

export interface OpencodeZenAuthStatus {
  connected: boolean;
  source: OpencodeZenAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveOpencodeZenApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.OPENCODE_ZEN_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: OPENCODE_ZEN_API_KEY_SECRET_ID,
    name: OPENCODE_ZEN_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertOpencodeZenApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: OPENCODE_ZEN_API_KEY_SECRET_ID,
    name: OPENCODE_ZEN_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeOpencodeZenApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: OPENCODE_ZEN_API_KEY_SECRET_ID,
    name: OPENCODE_ZEN_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getOpencodeZenAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): OpencodeZenAuthStatus {
  const env = process.env.OPENCODE_ZEN_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: OPENCODE_ZEN_API_KEY_SECRET_ID,
    name: OPENCODE_ZEN_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isOpencodeZenPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveOpencodeZenApiKey(db, agentId) != null;
}

export function isOpencodeZenVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === OPENCODE_ZEN_API_KEY_SECRET_NAME || n === "opencode-zen-api-key";
}

export function isOpencodeZenVaultSecretId(id: string): boolean {
  return (
    id === OPENCODE_ZEN_API_KEY_SECRET_ID ||
    id.startsWith(`${OPENCODE_ZEN_API_KEY_SECRET_ID}__agent__`)
  );
}

/**
 * True when agent config points at OpenCode Zen transport.
 * Excludes Go (`…/zen/go`).
 */
export function isOpencodeZenAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.opencodeZen === true || config.transport === "opencode_zen") return true;
  if (config.apiKeyRef === OPENCODE_ZEN_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("opencode.ai/zen") && !base.includes("opencode.ai/zen/go");
}
