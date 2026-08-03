import type { AppDatabase } from "../db.js";
import {
  deleteSecret,
  getSecretValue,
  listSecrets,
} from "./agents/agents-db.js";
import { encryptSecret } from "./holdings/crypto-box.js";

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

export function resolveOpenAiApiKey(db: AppDatabase): string | null {
  const env = process.env.OPENAI_API_KEY?.trim();
  if (env) return env;
  const byId = getSecretValue(db, OPENAI_API_KEY_SECRET_ID);
  if (byId) return byId;
  const byName = listSecrets(db).find((s) => s.name === OPENAI_API_KEY_SECRET_NAME);
  if (!byName) return null;
  return getSecretValue(db, byName.id);
}

export function upsertOpenAiApiKey(db: AppDatabase, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key required");
  db.prepare(`DELETE FROM ai_secrets WHERE id = ? OR name = ?`).run(
    OPENAI_API_KEY_SECRET_ID,
    OPENAI_API_KEY_SECRET_NAME
  );
  db.prepare(`INSERT INTO ai_secrets (id, name, value) VALUES (?, ?, ?)`).run(
    OPENAI_API_KEY_SECRET_ID,
    OPENAI_API_KEY_SECRET_NAME,
    encryptSecret(trimmed)
  );
}

export function removeOpenAiApiKey(db: AppDatabase): boolean {
  return deleteSecret(db, OPENAI_API_KEY_SECRET_ID);
}

export function getOpenAiAuthStatus(db: AppDatabase): OpenAiAuthStatus {
  const env = process.env.OPENAI_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const byId = getSecretValue(db, OPENAI_API_KEY_SECRET_ID);
  if (byId) {
    return { connected: true, source: "vault", masked: maskKey(byId) };
  }
  const named = listSecrets(db).find((s) => s.name === OPENAI_API_KEY_SECRET_NAME);
  if (named) {
    const value = getSecretValue(db, named.id);
    if (value) {
      return { connected: true, source: "vault", masked: maskKey(value) };
    }
  }
  return { connected: false, source: "none" };
}

/** True when OpenAI Platform models can be selected for Intelligence. */
export function isOpenAiPlatformReady(db: AppDatabase): boolean {
  return getOpenAiAuthStatus(db).connected;
}

export function isOpenAiVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === OPENAI_API_KEY_SECRET_NAME || n === "openai-api-key";
}

export function isOpenAiVaultSecretId(id: string): boolean {
  return id === OPENAI_API_KEY_SECRET_ID;
}
