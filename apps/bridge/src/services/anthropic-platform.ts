import type { AppDatabase } from "../db.js";
import {
  deleteSecret,
  getSecretValue,
  listSecrets,
} from "./agents/agents-db.js";
import { encryptSecret } from "./holdings/crypto-box.js";

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

export function resolveAnthropicApiKey(db: AppDatabase): string | null {
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) return env;
  const byId = getSecretValue(db, ANTHROPIC_API_KEY_SECRET_ID);
  if (byId) return byId;
  const byName = listSecrets(db).find((s) => s.name === ANTHROPIC_API_KEY_SECRET_NAME);
  if (!byName) return null;
  return getSecretValue(db, byName.id);
}

export function upsertAnthropicApiKey(db: AppDatabase, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key required");
  db.prepare(`DELETE FROM ai_secrets WHERE id = ? OR name = ?`).run(
    ANTHROPIC_API_KEY_SECRET_ID,
    ANTHROPIC_API_KEY_SECRET_NAME
  );
  db.prepare(`INSERT INTO ai_secrets (id, name, value) VALUES (?, ?, ?)`).run(
    ANTHROPIC_API_KEY_SECRET_ID,
    ANTHROPIC_API_KEY_SECRET_NAME,
    encryptSecret(trimmed)
  );
}

export function removeAnthropicApiKey(db: AppDatabase): boolean {
  return deleteSecret(db, ANTHROPIC_API_KEY_SECRET_ID);
}

export function getAnthropicAuthStatus(db: AppDatabase): AnthropicAuthStatus {
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const byId = getSecretValue(db, ANTHROPIC_API_KEY_SECRET_ID);
  if (byId) {
    return { connected: true, source: "vault", masked: maskKey(byId) };
  }
  const named = listSecrets(db).find((s) => s.name === ANTHROPIC_API_KEY_SECRET_NAME);
  if (named) {
    const value = getSecretValue(db, named.id);
    if (value) {
      return { connected: true, source: "vault", masked: maskKey(value) };
    }
  }
  return { connected: false, source: "none" };
}

export function isAnthropicPlatformReady(db: AppDatabase): boolean {
  return getAnthropicAuthStatus(db).connected;
}

export function isAnthropicVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === ANTHROPIC_API_KEY_SECRET_NAME || n === "anthropic-api-key";
}

export function isAnthropicVaultSecretId(id: string): boolean {
  return id === ANTHROPIC_API_KEY_SECRET_ID;
}
