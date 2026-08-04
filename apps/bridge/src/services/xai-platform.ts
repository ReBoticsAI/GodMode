import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for xAI console (metered) API key (#231). */
export const XAI_API_KEY_SECRET_ID = "xai-api-key";
export const XAI_API_KEY_SECRET_NAME = "xai_api_key";

/** OpenAI-compatible chat base. https://docs.x.ai/docs */
export const XAI_API_BASE_URL = "https://api.x.ai/v1";

/**
 * xAI console chat catalog snapshot (2026-08-03).
 * Custom model ids allowed via Apply.
 * https://docs.x.ai/docs/models
 */
export const XAI_CHAT_CATALOG = [
  { id: "grok-4.5", label: "Grok 4.5" },
  { id: "grok-4", label: "Grok 4" },
  { id: "grok-3-mini", label: "Grok 3 Mini" },
] as const;

export type XaiAuthSource = "env" | "vault" | "none";

export interface XaiAuthStatus {
  connected: boolean;
  source: XaiAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveXaiApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.XAI_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: XAI_API_KEY_SECRET_ID,
    name: XAI_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertXaiApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: XAI_API_KEY_SECRET_ID,
    name: XAI_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeXaiApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: XAI_API_KEY_SECRET_ID,
    name: XAI_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getXaiAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): XaiAuthStatus {
  const env = process.env.XAI_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: XAI_API_KEY_SECRET_ID,
    name: XAI_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isXaiPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveXaiApiKey(db, agentId) != null;
}

export function isXaiVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === XAI_API_KEY_SECRET_NAME || n === "xai-api-key";
}

export function isXaiVaultSecretId(id: string): boolean {
  return (
    id === XAI_API_KEY_SECRET_ID ||
    id.startsWith(`${XAI_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at xAI console transport. */
export function isXaiAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.xai === true || config.transport === "xai") return true;
  if (config.apiKeyRef === XAI_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.x.ai");
}
