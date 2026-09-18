import type { AppDatabase } from "../db.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  removePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "./agents/agents-db.js";
import { resolveGodModeInferenceSupplyKey } from "./godmode-inference-supply.js";

/** Fixed secret id/name for Alibaba DashScope / Qwen API key. */
export const DASHSCOPE_API_KEY_SECRET_ID = "dashscope-api-key";
export const DASHSCOPE_API_KEY_SECRET_NAME = "dashscope_api_key";

/**
 * OpenAI-compatible DashScope chat base (international).
 * Override with DASHSCOPE_API_BASE_URL when using the China endpoint.
 */
export const DASHSCOPE_API_BASE_URL =
  process.env.DASHSCOPE_API_BASE_URL?.trim() ||
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

/** Chat catalog snapshot for GodMode Inference / personal BYOK Qwen SKUs. */
export const DASHSCOPE_CHAT_CATALOG = [
  { id: "qwen-plus", label: "Qwen Plus" },
  { id: "qwen-max", label: "Qwen Max" },
  { id: "qwen-flash", label: "Qwen Flash" },
] as const;

/** Vault UI sources only. Platform admin supply is separate. */
export type DashScopeAuthSource = "env" | "vault" | "none";

export interface DashScopeAuthStatus {
  connected: boolean;
  source: DashScopeAuthSource;
  masked?: string;
}

function maskKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "****";
}

/** Chat / readiness: personal vault → Admin platform supply → env. */
export function resolveDashScopeApiKey(
  db: AppDatabase,
  agentId?: string | null
): string | null {
  const vault = resolvePlatformVaultSecret(db, {
    baseId: DASHSCOPE_API_KEY_SECRET_ID,
    name: DASHSCOPE_API_KEY_SECRET_NAME,
    agentId,
  });
  if (vault) return vault;
  return resolveGodModeInferenceSupplyKey("dashscope");
}

export function upsertDashScopeApiKey(
  db: AppDatabase,
  apiKey: string,
  agentId?: string | null
): void {
  upsertPlatformVaultSecret(db, {
    baseId: DASHSCOPE_API_KEY_SECRET_ID,
    name: DASHSCOPE_API_KEY_SECRET_NAME,
    value: apiKey,
    agentId,
  });
}

export function removeDashScopeApiKey(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return removePlatformVaultSecret(db, {
    baseId: DASHSCOPE_API_KEY_SECRET_ID,
    name: DASHSCOPE_API_KEY_SECRET_NAME,
    agentId,
  });
}

/** Personal / workspace BYOK for Vault cards (not Admin platform supply). */
export function getDashScopeAuthStatus(
  db: AppDatabase,
  agentId?: string | null
): DashScopeAuthStatus {
  const vault = getPlatformVaultSecretInScope(db, {
    baseId: DASHSCOPE_API_KEY_SECRET_ID,
    name: DASHSCOPE_API_KEY_SECRET_NAME,
    agentId,
  });
  if (vault) {
    return { connected: true, source: "vault", masked: maskKey(vault) };
  }
  const env =
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.QWEN_API_KEY?.trim() ||
    null;
  if (env) {
    return { connected: true, source: "env", masked: maskKey(env) };
  }
  return { connected: false, source: "none" };
}

export function isDashScopePlatformReady(
  db: AppDatabase,
  agentId?: string | null
): boolean {
  return resolveDashScopeApiKey(db, agentId) != null;
}

export function isDashScopeVaultSecretName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === DASHSCOPE_API_KEY_SECRET_NAME ||
    n === "dashscope-api-key" ||
    n === "qwen_api_key" ||
    n === "qwen-api-key"
  );
}

export function isDashScopeVaultSecretId(id: string): boolean {
  return (
    id === DASHSCOPE_API_KEY_SECRET_ID ||
    id.startsWith(`${DASHSCOPE_API_KEY_SECRET_ID}__agent__`)
  );
}

/** True when agent config points at DashScope / Qwen transport. */
export function isDashScopeAgentConfig(
  config: Record<string, unknown> | null | undefined
): boolean {
  if (!config) return false;
  if (
    config.dashscope === true ||
    config.transport === "dashscope" ||
    config.qwen === true
  ) {
    return true;
  }
  if (config.apiKeyRef === DASHSCOPE_API_KEY_SECRET_ID) return true;
  const base =
    typeof config.baseUrl === "string" ? config.baseUrl.toLowerCase() : "";
  return base.includes("dashscope") && base.includes("aliyuncs.com");
}
