import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";

/** Fixed secret id/name for DigitalOcean Gradient Inference (#355). */
export const DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID =
  "digitalocean-inference-api-key";
export const DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME =
  "digitalocean_inference_api_key";

/**
 * DigitalOcean Serverless Inference OpenAI-compatible base.
 * https://docs.digitalocean.com/reference/api/reference/serverless-inference/
 */
export const DIGITALOCEAN_INFERENCE_API_BASE_URL =
  "https://inference.do-ai.run/v1";

/**
 * DigitalOcean Inference chat catalog snapshot (2026-08-04).
 * Prefer chat/completions-compatible ids; custom slug allowed.
 */
export const DIGITALOCEAN_INFERENCE_CHAT_CATALOG = [
  { id: "llama3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
  { id: "openai-gpt-4o", label: "GPT-4o" },
  { id: "anthropic-claude-4.5-sonnet", label: "Claude Sonnet 4.5" },
  { id: "deepseek-4-flash", label: "DeepSeek V4 Flash" },
  { id: "kimi-k3", label: "Kimi K3" },
] as const;

export type DigitalOceanInferenceAuthSource = "env" | "vault" | "none";

export interface DigitalOceanInferenceAuthStatus {
  connected: boolean;
  source: DigitalOceanInferenceAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

export function resolveDigitalOceanInferenceApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const env = process.env.DIGITALOCEAN_INFERENCE_API_KEY?.trim();
  if (env) return env;
  return resolvePlatformVaultSecret(db, {
    baseId: DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID,
    name: DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function upsertDigitalOceanInferenceApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID,
    name: DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeDigitalOceanInferenceApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID,
    name: DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME,
    agentId,
  });
}

export function getDigitalOceanInferenceAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): DigitalOceanInferenceAuthStatus {
  const env = process.env.DIGITALOCEAN_INFERENCE_API_KEY?.trim();
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  const value = getPlatformVaultSecretInScope(db, {
    baseId: DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID,
    name: DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME,
    agentId,
  });
  if (value) {
    return { connected: true, source: "vault", masked: maskKey(value) };
  }
  return { connected: false, source: "none" };
}

export function isDigitalOceanInferencePlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveDigitalOceanInferenceApiKey(db, agentId) != null;
}

export function isDigitalOceanInferenceVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === DIGITALOCEAN_INFERENCE_API_KEY_SECRET_NAME ||
    n === "digitalocean-inference-api-key"
  );
}

export function isDigitalOceanInferenceVaultSecretId(id: string): boolean {
  return (
    id === DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID ||
    id.startsWith(`${DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at DigitalOcean Inference transport. */
export function isDigitalOceanInferenceAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (
    config.digitaloceanInference === true ||
    config.transport === "digitalocean_inference"
  ) {
    return true;
  }
  if (config.apiKeyRef === DIGITALOCEAN_INFERENCE_API_KEY_SECRET_ID) return true;
  const base = typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("inference.do-ai.run");
}
