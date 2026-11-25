import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/**
 * Fixed secret id/name for OpenCode Console pay-as-you-go inference.
 * Distinct from the OpenCode Go subscription (#230) and OpenCode Zen.
 */
export const OPENCODE_CONSOLE_API_KEY_SECRET_ID = "opencode-console-api-key";
export const OPENCODE_CONSOLE_API_KEY_SECRET_NAME = "opencode_console_api_key";

/**
 * OpenCode Console OpenAI-compatible base (metered payg).
 * Console also exposes native Anthropic/Google endpoints; GodMode uses the
 * OpenAI-compatible surface so every text model works through one transport.
 * https://opencode.ai/docs/console/api/inference/
 */
export const OPENCODE_CONSOLE_API_BASE_URL =
  "https://opencode.ai/inference/openai/v1";

/**
 * OpenCode Console chat catalog snapshot (2026-11-16).
 * Curated coding picks from the Console model list; every text model also
 * reaches the OpenAI-compatible endpoint, so the custom slug covers the rest.
 */
export const OPENCODE_CONSOLE_CHAT_CATALOG = [
  { id: "kimi-k3", label: "Kimi K3" },
  { id: "gpt-6.1-sol", label: "GPT 6.1 Sol" },
  { id: "glm-5.3", label: "GLM 5.3" },
  { id: "glm-5.3-flash", label: "GLM 5.3 Flash" },
  { id: "gpt-6-luna", label: "GPT 6 Luna" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
  { id: "grok-4.7", label: "Grok 4.7" },
  { id: "qwen3.8-max", label: "Qwen3.8 Max" },
] as const;

export type OpencodeConsoleAuthSource = "env" | "vault" | "none";

export interface OpencodeConsoleAuthStatus {
  connected: boolean;
  source: OpencodeConsoleAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveOpencodeConsoleApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env =
    process.env.OPENCODE_CONSOLE_API_KEY?.trim() ||
    process.env.OPENCODE_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: OPENCODE_CONSOLE_API_KEY_SECRET_ID,
    name: OPENCODE_CONSOLE_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertOpencodeConsoleApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: OPENCODE_CONSOLE_API_KEY_SECRET_ID,
    name: OPENCODE_CONSOLE_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeOpencodeConsoleApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: OPENCODE_CONSOLE_API_KEY_SECRET_ID,
    name: OPENCODE_CONSOLE_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getOpencodeConsoleAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): OpencodeConsoleAuthStatus {
  const env =
    process.env.OPENCODE_CONSOLE_API_KEY?.trim() ||
    process.env.OPENCODE_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: OPENCODE_CONSOLE_API_KEY_SECRET_ID,
    name: OPENCODE_CONSOLE_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isOpencodeConsolePlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveOpencodeConsoleApiKey(db, agentId) != null;
}

export function isOpencodeConsoleVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === OPENCODE_CONSOLE_API_KEY_SECRET_NAME || n === "opencode-console-api-key"
  );
}

export function isOpencodeConsoleVaultSecretId(id: string): boolean {
  return (
    id === OPENCODE_CONSOLE_API_KEY_SECRET_ID ||
    id.startsWith(`${OPENCODE_CONSOLE_API_KEY_SECRET_ID}__agent__`)
  );
}

/**
 * Live model ids from the Console models endpoint, cached after the Vault card
 * (or the models route) fetches them. The Intelligence picker merges these with
 * the static snapshot so every model the key can use is selectable.
 */
let liveModelCache: string[] | null = null;
let liveModelFetchedAt = 0;

export function setOpencodeConsoleModelCache(models: string[]): void {
  liveModelCache = [...new Set(models.filter((m) => m.trim().length > 0))];
  liveModelFetchedAt = Date.now();
}

export function getOpencodeConsoleModelCache(): string[] {
  return liveModelCache ?? [];
}

export function getOpencodeConsoleModelCacheAgeMs(): number {
  return liveModelCache ? Date.now() - liveModelFetchedAt : Number.POSITIVE_INFINITY;
}

let refreshInFlight = false;

/**
 * Fire-and-forget refresh of the live model cache when it is cold or stale.
 * Safe to call from synchronous catalog paths; failures are swallowed and the
 * static snapshot stays authoritative.
 */
export function refreshOpencodeConsoleModelCacheIfStale(
  db: AppDatabase,
  maxAgeMs = 10 * 60 * 1000
): void {
  if (refreshInFlight) return;
  if (liveModelCache && getOpencodeConsoleModelCacheAgeMs() < maxAgeMs) return;
  const apiKey = resolveOpencodeConsoleApiKey(db, null);
  if (!apiKey) return;
  refreshInFlight = true;
  void (async () => {
    try {
      const res = await fetch("https://opencode.ai/inference/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      const models = (json.data ?? [])
        .map((m) => (typeof m.id === "string" ? m.id : ""))
        .filter((id) => id.length > 0);
      if (models.length > 0) setOpencodeConsoleModelCache(models);
    } catch {
      /* keep the static snapshot */
    } finally {
      refreshInFlight = false;
    }
  })();
}

/** True when agent config points at the OpenCode Console payg transport. */
export function isOpencodeConsoleAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (config.opencodeConsole === true || config.transport === "opencode_console")
    return true;
  if (config.apiKeyRef === OPENCODE_CONSOLE_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("opencode.ai/inference");
}
