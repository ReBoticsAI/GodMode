import fs from "node:fs";
import type { AppDatabase } from "../db.js";
import { getCoreDb, getPlatformMeta } from "../core-db.js";
import { config } from "../config.js";
import type { LlmManager } from "./llm-manager.js";
import { isEmbeddingGguf } from "./llm-manager.js";
import { isCursorSubscriptionReady } from "./cursor-subscription.js";

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
  // Do not treat a process-global local llama as ready for every workspace —
  // that skipped the wizard for all hub users after one install completed.
  const llmReady = llmReadyFlag || cursorConnected;
  return { completed, llmReady, llmStatus, cursorConnected };
}

export function markOnboardingComplete(tenantDb: AppDatabase): void {
  writeTenantSetting(tenantDb, META_COMPLETED, "true");
}

export function markLlmReady(tenantDb: AppDatabase): void {
  writeTenantSetting(tenantDb, META_LLM_READY, "true");
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
