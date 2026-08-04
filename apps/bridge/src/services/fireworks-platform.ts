import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for Fireworks (metered) API key (#231). */
export const FIREWORKS_API_KEY_SECRET_ID = "fireworks-api-key";
export const FIREWORKS_API_KEY_SECRET_NAME = "fireworks_api_key";

/** OpenAI-compatible chat base (includes /v1). */
export const FIREWORKS_API_BASE_URL = "https://api.fireworks.ai/inference/v1";

/**
 * Fireworks serverless chat catalog snapshot (2026-08-03).
 * Prefer function-calling serverless models; custom slug remains on the Vault card.
 * https://docs.fireworks.ai/tools-sdks/openai-compatibility
 */
export const FIREWORKS_CHAT_CATALOG = [
  { id: "accounts/fireworks/models/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  {
    id: "accounts/fireworks/models/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
  },
  { id: "accounts/fireworks/models/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "accounts/fireworks/models/kimi-k3", label: "Kimi K3" },
  { id: "accounts/fireworks/models/glm-5p2", label: "GLM 5.2" },
  { id: "accounts/fireworks/models/minimax-m2p7", label: "MiniMax M2.7" },
] as const;

export type FireworksAuthSource = "env" | "vault" | "none";

export interface FireworksAuthStatus {
  connected: boolean;
  source: FireworksAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveFireworksApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.FIREWORKS_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: FIREWORKS_API_KEY_SECRET_ID,
    name: FIREWORKS_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertFireworksApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: FIREWORKS_API_KEY_SECRET_ID,
    name: FIREWORKS_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeFireworksApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: FIREWORKS_API_KEY_SECRET_ID,
    name: FIREWORKS_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getFireworksAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): FireworksAuthStatus {
  const env = process.env.FIREWORKS_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: FIREWORKS_API_KEY_SECRET_ID,
    name: FIREWORKS_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isFireworksPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveFireworksApiKey(db, agentId) != null;
}

export function isFireworksVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === FIREWORKS_API_KEY_SECRET_NAME || n === "fireworks-api-key";
}

export function isFireworksVaultSecretId(id: string): boolean {
  return (
    id === FIREWORKS_API_KEY_SECRET_ID ||
    id.startsWith(`${FIREWORKS_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at Fireworks transport. */
export function isFireworksAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.fireworks === true || config.transport === "fireworks") return true;
  if (config.apiKeyRef === FIREWORKS_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.fireworks.ai");
}
