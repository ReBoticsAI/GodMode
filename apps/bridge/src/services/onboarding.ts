import fs from "node:fs";
import type { AppDatabase } from "../db.js";
import { getCoreDb, getPlatformMeta, setPlatformMeta } from "../core-db.js";
import { config } from "../config.js";
import type { LlmManager } from "./llm-manager.js";
import { isCursorSubscriptionReady } from "./cursor-subscription.js";

const META_COMPLETED = "onboarding.completed";
const META_LLM_READY = "onboarding.llm_ready";

export function getOnboardingStatus(
  llm: LlmManager,
  tenantDb?: AppDatabase | null
): {
  completed: boolean;
  llmReady: boolean;
  llmStatus: ReturnType<LlmManager["getStatus"]>;
  cursorConnected: boolean;
} {
  const core = getCoreDb();
  const completed = getPlatformMeta(core, META_COMPLETED) === "true";
  const llmReadyFlag = getPlatformMeta(core, META_LLM_READY) === "true";
  const llmStatus = llm.getStatus();
  const cursorConnected = tenantDb ? isCursorSubscriptionReady(tenantDb) : false;
  const llmReady = llmReadyFlag || llmStatus.state === "running" || cursorConnected;
  return { completed, llmReady, llmStatus, cursorConnected };
}

export function markOnboardingComplete(): void {
  const core = getCoreDb();
  setPlatformMeta(core, META_COMPLETED, "true");
}

export function markLlmReady(): void {
  const core = getCoreDb();
  setPlatformMeta(core, META_LLM_READY, "true");
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
        if (f.endsWith(".gguf")) out.add(f);
      }
    } catch {
      /* skip */
    }
  }
  return [...out];
}
