import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for OpenAI Platform (metered) API key (#231). */
export const OPENAI_API_KEY_SECRET_ID = "openai-api-key";
export const OPENAI_API_KEY_SECRET_NAME = "openai_api_key";

export type OpenAiAuthSource = "env" | "vault" | "none";

export interface OpenAiAuthStatus {
  connected: boolean;
  source: OpenAiAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

/** Runtime resolve: env, then agent Vault, then Personal. */
export function resolveOpenAiApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.OPENAI_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: OPENAI_API_KEY_SECRET_ID,
    name: OPENAI_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertOpenAiApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: OPENAI_API_KEY_SECRET_ID,
    name: OPENAI_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeOpenAiApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: OPENAI_API_KEY_SECRET_ID,
    name: OPENAI_API_KEY_SECRET_NAME,
    agentId,
  });
}

/** UI status for one owner (no personal fallback when agentId is set). */
export function getOpenAiAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): OpenAiAuthStatus {
  const env = process.env.OPENAI_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: OPENAI_API_KEY_SECRET_ID,
    name: OPENAI_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

/** True when OpenAI Platform models can be selected (agent → personal). */
export function isOpenAiPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveOpenAiApiKey(db, agentId) != null;
}

export function isOpenAiVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === OPENAI_API_KEY_SECRET_NAME || n === "openai-api-key";
}

export function isOpenAiVaultSecretId(id: string): boolean {
  return (
    id === OPENAI_API_KEY_SECRET_ID ||
    id.startsWith(`${OPENAI_API_KEY_SECRET_ID}__agent__`)
  );
}
