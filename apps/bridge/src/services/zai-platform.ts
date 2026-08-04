import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret id/name for Z.AI general payg (#231).
 * Distinct from GLM Coding Plan subscription keys (#230).
 */
export const ZAI_API_KEY_SECRET_ID = "zai-api-key";
export const ZAI_API_KEY_SECRET_NAME = "zai_api_key";

/**
 * General OpenAI-compatible base (metered Platform).
 * Do not use https://api.z.ai/api/coding/paas/v4 for payg keys.
 * https://docs.z.ai/api-reference/introduction
 */
export const ZAI_API_BASE_URL = "https://api.z.ai/api/paas/v4";

/**
 * Z.AI payg chat catalog snapshot (2026-08-03).
 * Custom slug remains on the Vault card.
 */
export const ZAI_CHAT_CATALOG = [
  { id: "glm-5.2", label: "GLM-5.2" },
  { id: "glm-5.1", label: "GLM-5.1" },
  { id: "glm-5", label: "GLM-5" },
  { id: "glm-4.7", label: "GLM-4.7" },
] as const;

export type ZaiAuthSource = "env" | "vault" | "none";

export interface ZaiAuthStatus {
  connected: boolean;
  source: ZaiAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveZaiApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.ZAI_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: ZAI_API_KEY_SECRET_ID,
    name: ZAI_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertZaiApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: ZAI_API_KEY_SECRET_ID,
    name: ZAI_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeZaiApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: ZAI_API_KEY_SECRET_ID,
    name: ZAI_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getZaiAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): ZaiAuthStatus {
  const env = process.env.ZAI_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: ZAI_API_KEY_SECRET_ID,
    name: ZAI_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isZaiPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveZaiApiKey(db, agentId) != null;
}

export function isZaiVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === ZAI_API_KEY_SECRET_NAME || n === "zai-api-key";
}

export function isZaiVaultSecretId(id: string): boolean {
  return (
    id === ZAI_API_KEY_SECRET_ID ||
    id.startsWith(`${ZAI_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at Z.AI general payg (not Coding Plan). */
export function isZaiAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.zai === true || config.transport === "zai") return true;
  if (config.apiKeyRef === ZAI_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.z.ai/api/paas") && !base.includes("/api/coding/");
}
