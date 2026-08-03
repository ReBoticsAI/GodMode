import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for Anthropic Console (metered) API key (#231). */
export const ANTHROPIC_API_KEY_SECRET_ID = "anthropic-api-key";
export const ANTHROPIC_API_KEY_SECRET_NAME = "anthropic_api_key";

export type AnthropicAuthSource = "env" | "vault" | "none";

export interface AnthropicAuthStatus {
  connected: boolean;
  source: AnthropicAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveAnthropicApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: ANTHROPIC_API_KEY_SECRET_ID,
    name: ANTHROPIC_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertAnthropicApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: ANTHROPIC_API_KEY_SECRET_ID,
    name: ANTHROPIC_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeAnthropicApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: ANTHROPIC_API_KEY_SECRET_ID,
    name: ANTHROPIC_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getAnthropicAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): AnthropicAuthStatus {
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: ANTHROPIC_API_KEY_SECRET_ID,
    name: ANTHROPIC_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isAnthropicPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveAnthropicApiKey(db, agentId) != null;
}

export function isAnthropicVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === ANTHROPIC_API_KEY_SECRET_NAME || n === "anthropic-api-key";
}

export function isAnthropicVaultSecretId(id: string): boolean {
  return (
    id === ANTHROPIC_API_KEY_SECRET_ID ||
    id.startsWith(`${ANTHROPIC_API_KEY_SECRET_ID}__agent__`)
  );
}
