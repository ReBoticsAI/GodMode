import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for OpenCode Go subscription (#230). */
export const OPENCODE_GO_API_KEY_SECRET_ID = "opencode-go-api-key";
export const OPENCODE_GO_API_KEY_SECRET_NAME = "opencode_go_api_key";

/**
 * OpenCode Go OpenAI-compatible base (subscription plan).
 * https://opencode.ai/docs/go/
 */
export const OPENCODE_GO_API_BASE_URL = "https://opencode.ai/zen/go/v1";

/**
 * OpenCode Go chat catalog snapshot (2026-08-03).
 * Prefer chat/completions-compatible ids; custom slug allowed.
 */
export const OPENCODE_GO_CHAT_CATALOG = [
  { id: "grok-4.5", label: "Grok 4.5" },
  { id: "glm-5.2", label: "GLM-5.2" },
  { id: "kimi-k3", label: "Kimi K3" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
] as const;

export type OpencodeGoAuthSource = "env" | "vault" | "none";

export interface OpencodeGoAuthStatus {
  connected: boolean;
  source: OpencodeGoAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveOpencodeGoApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.OPENCODE_GO_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: OPENCODE_GO_API_KEY_SECRET_ID,
    name: OPENCODE_GO_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertOpencodeGoApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: OPENCODE_GO_API_KEY_SECRET_ID,
    name: OPENCODE_GO_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeOpencodeGoApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: OPENCODE_GO_API_KEY_SECRET_ID,
    name: OPENCODE_GO_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getOpencodeGoAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): OpencodeGoAuthStatus {
  const env = process.env.OPENCODE_GO_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: OPENCODE_GO_API_KEY_SECRET_ID,
    name: OPENCODE_GO_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isOpencodeGoPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveOpencodeGoApiKey(db, agentId) != null;
}

export function isOpencodeGoVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === OPENCODE_GO_API_KEY_SECRET_NAME || n === "opencode-go-api-key";
}

export function isOpencodeGoVaultSecretId(id: string): boolean {
  return (
    id === OPENCODE_GO_API_KEY_SECRET_ID ||
    id.startsWith(`${OPENCODE_GO_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at OpenCode Go transport. */
export function isOpencodeGoAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.opencodeGo === true || config.transport === "opencode_go") return true;
  if (config.apiKeyRef === OPENCODE_GO_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("opencode.ai/zen/go");
}
