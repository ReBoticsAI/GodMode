import fs from "node:fs";
import type { AppDatabase } from "../db.js";
import { getCoreDb, getPlatformMeta } from "../core-db.js";
import { config } from "../config.js";
import type { LlmManager } from "./llm-manager.js";
import { isEmbeddingGguf } from "./llm-manager.js";
import {
  getCursorAuthStatus,
  isCursorSubscriptionReady,
} from "./cursor-subscription.js";
import { getOpenAiAuthStatus, isOpenAiPlatformReady } from "./openai-platform.js";
import {
  getAnthropicAuthStatus,
  isAnthropicPlatformReady,
} from "./anthropic-platform.js";
import {
  getOpenRouterAuthStatus,
  isOpenRouterPlatformReady,
} from "./openrouter-platform.js";
import { getGroqAuthStatus, isGroqPlatformReady } from "./groq-platform.js";
import {
  getTogetherAuthStatus,
  isTogetherPlatformReady,
} from "./together-platform.js";
import {
  getFireworksAuthStatus,
  isFireworksPlatformReady,
} from "./fireworks-platform.js";
import {
  getDeepSeekAuthStatus,
  isDeepSeekPlatformReady,
} from "./deepseek-platform.js";
import {
  getGoogleAiAuthStatus,
  isGoogleAiPlatformReady,
} from "./google-ai-platform.js";
import {
  getXaiAuthStatus,
  isXaiPlatformReady,
} from "./xai-platform.js";
import {
  getZaiAuthStatus,
  isZaiPlatformReady,
} from "./zai-platform.js";
import {
  getMinimaxAuthStatus,
  isMinimaxPlatformReady,
} from "./minimax-platform.js";
import {
  getCustomOpenAiAuthStatus,
  isCustomOpenAiPlatformReady,
} from "./custom-openai-platform.js";
import {
  getZaiCodingAuthStatus,
  isZaiCodingPlatformReady,
} from "./zai-coding-platform.js";
import {
  getOpencodeGoAuthStatus,
  isOpencodeGoPlatformReady,
} from "./opencode-go-platform.js";
import {
  getDigitalOceanInferenceAuthStatus,
  isDigitalOceanInferencePlatformReady,
} from "./digitalocean-inference-platform.js";
import {
  getSnowflakeCortexAuthStatus,
  isSnowflakeCortexPlatformReady,
} from "./snowflake-cortex-platform.js";
import {
  getMinimaxTokenAuthStatus,
  isMinimaxTokenPlatformReady,
} from "./minimax-token-platform.js";
import {
  getKimiCodeAuthStatus,
  isKimiCodePlatformReady,
} from "./kimi-code-platform.js";
import {
  getPoeAuthStatus,
  isPoePlatformReady,
} from "./poe-platform.js";
import {
  getOpencodeZenAuthStatus,
  isOpencodeZenPlatformReady,
} from "./opencode-zen-platform.js";

/** Per-tenant keys in `ai_settings` (not platform_meta). */
const META_COMPLETED = "onboarding.completed";
const META_LLM_READY = "onboarding.llm_ready";

/** Legacy platform-wide keys (pre multi-tenant onboarding). */
const PLATFORM_COMPLETED = "onboarding.completed";
const PLATFORM_LLM_READY = "onboarding.llm_ready";

function readTenantSetting(db: AppDatabase, key: string): string | undefined {
  const row = db
    .prepare(`SELECT value FROM ai_settings WHERE key=?`)
    .get(key) as { value: string } | undefined;
  return row?.value;
}

function writeTenantSetting(db: AppDatabase, key: string, value: string): void {
  db.prepare(
    `INSERT INTO ai_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`
  ).run(key, value);
}

/**
 * Local single-workspace installs used to store onboarding on platform_meta.
 * Copy once into the active tenant DB. Hub mode never migrates — each workspace
 * must complete the wizard itself.
 */
function maybeMigrateLegacyPlatformOnboarding(db: AppDatabase): void {
  if (config.isHub) return;
  if (readTenantSetting(db, META_COMPLETED) != null) return;

  const core = getCoreDb();
  const completed = getPlatformMeta(core, PLATFORM_COMPLETED);
  const llmReady = getPlatformMeta(core, PLATFORM_LLM_READY);
  if (completed === "true") writeTenantSetting(db, META_COMPLETED, "true");
  if (llmReady === "true") writeTenantSetting(db, META_LLM_READY, "true");
}

/**
 * Hub/SaaS: any Vault BYOK LLM provider (OpenAI / Anthropic / OpenRouter / Groq /
 * Together / Fireworks / DeepSeek / Google AI Studio / xAI / Z.AI / MiniMax /
 * custom OpenAI-compatible / Z.AI Coding Plan / OpenCode Go / DigitalOcean
 * Inference / Snowflake Cortex / MiniMax Token Plan /
 * Kimi Code / Poe / OpenCode Zen) counts as
 * ready. Process-env keys do not: same multi-tenant rule as Cursor vault-only readiness.
 */
function isHubVaultCloudPlatformReady(db: AppDatabase): boolean {
  if (!config.isHub) return false;
  const vaultReady = (ready: boolean, source: string) =>
    ready && source === "vault";
  return (
    vaultReady(isOpenAiPlatformReady(db), getOpenAiAuthStatus(db).source) ||
    vaultReady(isAnthropicPlatformReady(db), getAnthropicAuthStatus(db).source) ||
    vaultReady(
      isOpenRouterPlatformReady(db),
      getOpenRouterAuthStatus(db).source
    ) ||
    vaultReady(isGroqPlatformReady(db), getGroqAuthStatus(db).source) ||
    vaultReady(isTogetherPlatformReady(db), getTogetherAuthStatus(db).source) ||
    vaultReady(isFireworksPlatformReady(db), getFireworksAuthStatus(db).source) ||
    vaultReady(isDeepSeekPlatformReady(db), getDeepSeekAuthStatus(db).source) ||
    vaultReady(isGoogleAiPlatformReady(db), getGoogleAiAuthStatus(db).source) ||
    vaultReady(isXaiPlatformReady(db), getXaiAuthStatus(db).source) ||
    vaultReady(isZaiPlatformReady(db), getZaiAuthStatus(db).source) ||
    vaultReady(isMinimaxPlatformReady(db), getMinimaxAuthStatus(db).source) ||
    vaultReady(
      isCustomOpenAiPlatformReady(db),
      getCustomOpenAiAuthStatus(db).source
    ) ||
    vaultReady(isZaiCodingPlatformReady(db), getZaiCodingAuthStatus(db).source) ||
    vaultReady(isOpencodeGoPlatformReady(db), getOpencodeGoAuthStatus(db).source) ||
    vaultReady(
      isDigitalOceanInferencePlatformReady(db),
      getDigitalOceanInferenceAuthStatus(db).source
    ) ||
    vaultReady(
      isSnowflakeCortexPlatformReady(db),
      getSnowflakeCortexAuthStatus(db).source
    ) ||
    vaultReady(
      isMinimaxTokenPlatformReady(db),
      getMinimaxTokenAuthStatus(db).source
    ) ||
    vaultReady(isKimiCodePlatformReady(db), getKimiCodeAuthStatus(db).source) ||
    vaultReady(isPoePlatformReady(db), getPoeAuthStatus(db).source) ||
    vaultReady(isOpencodeZenPlatformReady(db), getOpencodeZenAuthStatus(db).source)
  );
}

export function getOnboardingStatus(
  llm: LlmManager,
  tenantDb?: AppDatabase | null
): {
  completed: boolean;
  llmReady: boolean;
  llmStatus: ReturnType<LlmManager["getStatus"]>;
  cursorConnected: boolean;
} {
  const llmStatus = llm.getStatus();
  if (!tenantDb) {
    return {
      completed: false,
      llmReady: false,
      llmStatus,
      cursorConnected: false,
    };
  }

  maybeMigrateLegacyPlatformOnboarding(tenantDb);

  const completed = readTenantSetting(tenantDb, META_COMPLETED) === "true";
  const llmReadyFlag = readTenantSetting(tenantDb, META_LLM_READY) === "true";
  const cursorConnected = isCursorSubscriptionReady(tenantDb);
  // Do not treat process-global LLM credentials as ready for every workspace.
  // Hub/SaaS: only a tenant Vault Cursor key, Vault cloud platform key, or
  // explicit llm_ready skips the wizard. Local/client may still use
  // CURSOR_API_KEY from the environment.
  const cursorReadyForTenant =
    cursorConnected &&
    (!config.isHub || getCursorAuthStatus(tenantDb).source === "vault");
  const llmReady =
    llmReadyFlag || cursorReadyForTenant || isHubVaultCloudPlatformReady(tenantDb);
  return { completed, llmReady, llmStatus, cursorConnected };
}

export function markOnboardingComplete(tenantDb: AppDatabase): void {
  writeTenantSetting(tenantDb, META_COMPLETED, "true");
}

export function markLlmReady(tenantDb: AppDatabase): void {
  writeTenantSetting(tenantDb, META_LLM_READY, "true");
}

/** Clear flags so the first-run wizard can show again (Settings → reopen). */
export function resetOnboarding(tenantDb: AppDatabase): void {
  writeTenantSetting(tenantDb, META_COMPLETED, "false");
  writeTenantSetting(tenantDb, META_LLM_READY, "false");
}

export async function detectOllama(): Promise<{
  available: boolean;
  models: string[];
}> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { available: false, models: [] };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return {
      available: true,
      models: (data.models ?? []).map((m) => m.name),
    };
  } catch {
    return { available: false, models: [] };
  }
}

export function listLocalGgufModels(): string[] {
  const out = new Set<string>();
  for (const dir of config.ai.modelDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        const lower = f.toLowerCase();
        if (!lower.endsWith(".gguf")) continue;
        if (isEmbeddingGguf(f) || lower.includes("mmproj")) continue;
        out.add(f);
      }
    } catch {
      /* skip */
    }
  }
  return [...out];
}
