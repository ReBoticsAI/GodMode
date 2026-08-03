import type { AppDatabase } from "../db.js";
import {
  deleteSecret,
  getSecretValue,
  listSecrets,
} from "./agents/agents-db.js";
import { encryptSecret } from "./holdings/crypto-box.js";

/** Fixed secret id/name for Groq (metered) API key (#231). */
export const GROQ_API_KEY_SECRET_ID = "groq-api-key";
export const GROQ_API_KEY_SECRET_NAME = "groq_api_key";

/** OpenAI-compatible chat base (includes /v1). */
export const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Groq production chat catalog snapshot (2026-08-03).
 * Excludes Whisper/TTS/prompt-guard; custom slug remains on the Vault card.
 * https://console.groq.com/docs/models
 */
export const GROQ_CHAT_CATALOG = [
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  { id: "groq/compound", label: "Compound" },
  { id: "groq/compound-mini", label: "Compound Mini" },
] as const;

export type GroqAuthSource = "env" | "vault" | "none";

export interface GroqAuthStatus {
  connected: boolean;
  source: GroqAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveGroqApiKey(db: AppDatabase): string | null {
  const env = process.env.GROQ_API_KEY?.trim();
  if (env) return env;
  const byId = getSecretValue(db, GROQ_API_KEY_SECRET_ID);
  if (byId) return byId;
  const byName = listSecrets(db).find((s) => s.name === GROQ_API_KEY_SECRET_NAME);
  if (!byName) return null;
  return getSecretValue(db, byName.id);
}

export function upsertGroqApiKey(db: AppDatabase, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key required");
  db.prepare(`DELETE FROM ai_secrets WHERE id = ? OR name = ?`).run(
    GROQ_API_KEY_SECRET_ID,
    GROQ_API_KEY_SECRET_NAME
  );
  db.prepare(`INSERT INTO ai_secrets (id, name, value) VALUES (?, ?, ?)`).run(
    GROQ_API_KEY_SECRET_ID,
    GROQ_API_KEY_SECRET_NAME,
    encryptSecret(trimmed)
  );
}

export function removeGroqApiKey(db: AppDatabase): boolean {
  return deleteSecret(db, GROQ_API_KEY_SECRET_ID);
}

export function getGroqAuthStatus(db: AppDatabase): GroqAuthStatus {
  const env = process.env.GROQ_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const byId = getSecretValue(db, GROQ_API_KEY_SECRET_ID);
  if (byId) {
    return { connected: true, source: "vault", masked: maskKey(byId) };
  }
  const named = listSecrets(db).find((s) => s.name === GROQ_API_KEY_SECRET_NAME);
  if (named) {
    const value = getSecretValue(db, named.id);
    if (value) {
      return { connected: true, source: "vault", masked: maskKey(value) };
    }
  }
  return { connected: false, source: "none" };
}

export function isGroqPlatformReady(db: AppDatabase): boolean {
  return getGroqAuthStatus(db).connected;
}

export function isGroqVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === GROQ_API_KEY_SECRET_NAME || n === "groq-api-key";
}

export function isGroqVaultSecretId(id: string): boolean {
  return id === GROQ_API_KEY_SECRET_ID;
}

/** True when agent config points at Groq transport. */
export function isGroqAgentConfig(config: Record<string, unknown> | null | undefined): boolean {
  if (!config) return false;
  if (config.groq === true || config.transport === "groq") return true;
  if (config.apiKeyRef === GROQ_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("api.groq.com");
}
