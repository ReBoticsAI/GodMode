import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for Google AI Studio / Gemini API key (#231). */
export const GOOGLE_AI_API_KEY_SECRET_ID = "google-ai-api-key";
export const GOOGLE_AI_API_KEY_SECRET_NAME = "google_ai_api_key";

/**
 * OpenAI-compatible chat base (Google AI Studio / Gemini API).
 * https://ai.google.dev/gemini-api/docs/openai
 */
export const GOOGLE_AI_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

/**
 * Google AI Studio chat catalog snapshot (2026-08-03).
 * Custom model ids allowed via Apply.
 * https://ai.google.dev/gemini-api/docs/models
 */
export const GOOGLE_AI_CHAT_CATALOG = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
] as const;

export type GoogleAiAuthSource = "env" | "vault" | "none";

export interface GoogleAiAuthStatus {
  connected: boolean;
  source: GoogleAiAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

function envGoogleAiApiKey(): string | null {
  const primary = process.env.GOOGLE_AI_API_KEY?.trim();
  if (primary) return primary;
  const gemini = process.env.GEMINI_API_KEY?.trim();
  return gemini || null;
}

export function resolveGoogleAiApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = envGoogleAiApiKey();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: GOOGLE_AI_API_KEY_SECRET_ID,
    name: GOOGLE_AI_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertGoogleAiApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: GOOGLE_AI_API_KEY_SECRET_ID,
    name: GOOGLE_AI_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeGoogleAiApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: GOOGLE_AI_API_KEY_SECRET_ID,
    name: GOOGLE_AI_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getGoogleAiAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): GoogleAiAuthStatus {
  const env = envGoogleAiApiKey();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: GOOGLE_AI_API_KEY_SECRET_ID,
    name: GOOGLE_AI_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isGoogleAiPlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveGoogleAiApiKey(db, agentId) != null;
}

export function isGoogleAiVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === GOOGLE_AI_API_KEY_SECRET_NAME ||
    n === "google-ai-api-key" ||
    n === "gemini_api_key" ||
    n === "gemini-api-key"
  );
}

export function isGoogleAiVaultSecretId(id: string): boolean {
  return (
    id === GOOGLE_AI_API_KEY_SECRET_ID ||
    id.startsWith(`${GOOGLE_AI_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at Google AI Studio transport. */
export function isGoogleAiAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (
    config.googleAi === true ||
    config.google_ai === true ||
    config.transport === "google_ai"
  ) {
    return true;
  }
  if (config.apiKeyRef === GOOGLE_AI_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("generativelanguage.googleapis.com");
}
