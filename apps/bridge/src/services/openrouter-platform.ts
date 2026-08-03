import type { AppDatabase } from "../db.js";
import {
  deleteSecret,
  getSecretValue,
  listSecrets,
} from "./agents/agents-db.js";
import { encryptSecret } from "./holdings/crypto-box.js";

/** Fixed secret id/name for OpenRouter (metered) API key (#231). */
export const OPENROUTER_API_KEY_SECRET_ID = "openrouter-api-key";
export const OPENROUTER_API_KEY_SECRET_NAME = "openrouter_api_key";

/** OpenAI-compatible chat base (includes /v1). */
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter usage top-10 snapshot (2026-08-03 weekly tokens).
 * Rankings drift; custom slug remains available on the Vault card.
 */
export const OPENROUTER_TOP10_CATALOG = [
  {
    id: "deepseek/deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash 0731",
  },
  { id: "xiaomi/mimo-v2.5", label: "MiMo-V2.5" },
  { id: "tencent/hy3", label: "Hy3" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "z-ai/glm-5.2", label: "GLM 5.2" },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra (free)",
  },
  { id: "minimax/minimax-m3", label: "MiniMax M3" },
  { id: "stepfun/step-3.7-flash", label: "Step 3.7 Flash" },
  { id: "moonshotai/kimi-k3", label: "Kimi K3" },
  {
    id: "inclusionai/ling-3.0-flash:free",
    label: "Ling-3.0-flash (free)",
  },
] as const;

export type OpenRouterAuthSource = "env" | "vault" | "none";

export interface OpenRouterAuthStatus {
  connected: boolean;
  source: OpenRouterAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveOpenRouterApiKey(db: AppDatabase): string | null {
  const env = process.env.OPENROUTER_API_KEY?.trim();
  if (env) return env;
  const byId = getSecretValue(db, OPENROUTER_API_KEY_SECRET_ID);
  if (byId) return byId;
  const byName = listSecrets(db).find((s) => s.name === OPENROUTER_API_KEY_SECRET_NAME);
  if (!byName) return null;
  return getSecretValue(db, byName.id);
}

export function upsertOpenRouterApiKey(db: AppDatabase, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key required");
  db.prepare(`DELETE FROM ai_secrets WHERE id = ? OR name = ?`).run(
    OPENROUTER_API_KEY_SECRET_ID,
    OPENROUTER_API_KEY_SECRET_NAME
  );
  db.prepare(`INSERT INTO ai_secrets (id, name, value) VALUES (?, ?, ?)`).run(
    OPENROUTER_API_KEY_SECRET_ID,
    OPENROUTER_API_KEY_SECRET_NAME,
    encryptSecret(trimmed)
  );
}

export function removeOpenRouterApiKey(db: AppDatabase): boolean {
  return deleteSecret(db, OPENROUTER_API_KEY_SECRET_ID);
}

export function getOpenRouterAuthStatus(db: AppDatabase): OpenRouterAuthStatus {
  const env = process.env.OPENROUTER_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const byId = getSecretValue(db, OPENROUTER_API_KEY_SECRET_ID);
  if (byId) {
    return { connected: true, source: "vault", masked: maskKey(byId) };
  }
  const named = listSecrets(db).find((s) => s.name === OPENROUTER_API_KEY_SECRET_NAME);
  if (named) {
    const value = getSecretValue(db, named.id);
    if (value) {
      return { connected: true, source: "vault", masked: maskKey(value) };
    }
  }
  return { connected: false, source: "none" };
}

export function isOpenRouterPlatformReady(db: AppDatabase): boolean {
  return getOpenRouterAuthStatus(db).connected;
}

export function isOpenRouterVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return n === OPENROUTER_API_KEY_SECRET_NAME || n === "openrouter-api-key";
}

export function isOpenRouterVaultSecretId(id: string): boolean {
  return id === OPENROUTER_API_KEY_SECRET_ID;
}

/** True when agent config points at OpenRouter transport. */
export function isOpenRouterAgentConfig(config: Record<string, unknown> | null | undefined): boolean {
  if (!config) return false;
  if (config.openrouter === true || config.transport === "openrouter") return true;
  if (config.apiKeyRef === OPENROUTER_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("openrouter.ai");
}
