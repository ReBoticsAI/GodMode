import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret id/name for Z.AI GLM Coding Plan (#230).
 * Distinct from general Z.AI / Moonshot payg keys (#231).
 */
export const ZAI_CODING_API_KEY_SECRET_ID = "zai-coding-api-key";
export const ZAI_CODING_API_KEY_SECRET_NAME = "zai_coding_api_key";

/**
 * Coding Plan OpenAI-compatible base (quota applies only on this path).
 * Do not use https://api.z.ai/api/paas/v4 for Coding Plan keys.
 * https://docs.z.ai/devpack/quick-start
 */
export const ZAI_CODING_API_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

/**
 * GLM Coding Plan chat catalog snapshot (2026-08-03).
 * Custom slug remains on the Vault card.
 */
export const ZAI_CODING_CHAT_CATALOG = [
  { id: "glm-5.1", label: "GLM-5.1" },
  { id: "glm-5", label: "GLM-5" },
  { id: "glm-4.7", label: "GLM-4.7" },
  { id: "glm-4.5-air", label: "GLM-4.5 Air" },
] as const;

export type ZaiCodingAuthSource = "env" | "vault" | "none";

export interface ZaiCodingAuthStatus {
  connected: boolean;
  source: ZaiCodingAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveZaiCodingApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.ZAI_CODING_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: ZAI_CODING_API_KEY_SECRET_ID,
    name: ZAI_CODING_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertZaiCodingApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: ZAI_CODING_API_KEY_SECRET_ID,
    name: ZAI_CODING_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeZaiCodingApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: ZAI_CODING_API_KEY_SECRET_ID,
    name: ZAI_CODING_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getZaiCodingAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): ZaiCodingAuthStatus {
  const env = process.env.ZAI_CODING_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: ZAI_CODING_API_KEY_SECRET_ID,
    name: ZAI_CODING_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isZaiCodingPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveZaiCodingApiKey(db, agentId) != null;
}

export function isZaiCodingVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === ZAI_CODING_API_KEY_SECRET_NAME || n === "zai-coding-api-key";
}

export function isZaiCodingVaultSecretId(id: string): boolean {
  return (
    id === ZAI_CODING_API_KEY_SECRET_ID ||
    id.startsWith(`${ZAI_CODING_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at Z.AI Coding Plan transport. */
export function isZaiCodingAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.zaiCoding === true || config.transport === "zai_coding") return true;
  if (config.apiKeyRef === ZAI_CODING_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.z.ai/api/coding/");
}
