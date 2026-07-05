import type { AppDatabase } from "../db.js";
import { getAgent, updateAgent } from "./agents/agents-db.js";

export type ReflectionMode = "approval" | "auto";
export type ReflectionTrigger = "manual" | "scheduled" | "idle" | "queued";

export interface AgentReflectionSchedule {
  enabled: boolean;
  cron: string;
  timezone: string;
}

export interface AgentReflectionIdle {
  enabled: boolean;
  afterMinutes: number;
}

export interface AgentReflectionConfig {
  enabled: boolean;
  mode: ReflectionMode;
  schedule: AgentReflectionSchedule;
  idle: AgentReflectionIdle;
  lastRunAt: string | null;
  lastSummary: string | null;
  watermark: string | null;
}

export const DEFAULT_REFLECTION_CONFIG: AgentReflectionConfig = {
  enabled: false,
  mode: "approval",
  schedule: {
    enabled: false,
    cron: "0 2 * * *",
    timezone: "America/Denver",
  },
  idle: {
    enabled: true,
    afterMinutes: 30,
  },
  lastRunAt: null,
  lastSummary: null,
  watermark: null,
};

function mergeReflection(
  raw: Partial<AgentReflectionConfig> | undefined
): AgentReflectionConfig {
  const base = DEFAULT_REFLECTION_CONFIG;
  if (!raw) return { ...base };
  return {
    enabled: raw.enabled ?? base.enabled,
    mode: raw.mode === "auto" ? "auto" : "approval",
    schedule: {
      enabled: raw.schedule?.enabled ?? base.schedule.enabled,
      cron: raw.schedule?.cron ?? base.schedule.cron,
      timezone: raw.schedule?.timezone ?? base.schedule.timezone,
    },
    idle: {
      enabled: raw.idle?.enabled ?? base.idle.enabled,
      afterMinutes: Number(raw.idle?.afterMinutes ?? base.idle.afterMinutes) || 30,
    },
    lastRunAt: raw.lastRunAt ?? base.lastRunAt,
    lastSummary: raw.lastSummary ?? base.lastSummary,
    watermark: raw.watermark ?? base.watermark,
  };
}

export function getReflectionConfig(db: AppDatabase, agentId: string): AgentReflectionConfig {
  const agent = getAgent(db, agentId);
  if (!agent) return { ...DEFAULT_REFLECTION_CONFIG };
  const raw = agent.config?.reflection as Partial<AgentReflectionConfig> | undefined;
  return mergeReflection(raw);
}

export function patchReflectionConfig(
  db: AppDatabase,
  agentId: string,
  patch: Partial<Omit<AgentReflectionConfig, "lastRunAt" | "lastSummary" | "watermark">> & {
    lastRunAt?: string | null;
    lastSummary?: string | null;
    watermark?: string | null;
  }
): AgentReflectionConfig | null {
  const agent = getAgent(db, agentId);
  if (!agent) return null;
  const current = mergeReflection(agent.config?.reflection as Partial<AgentReflectionConfig>);
  const next = mergeReflection({ ...current, ...patch });
  updateAgent(db, agentId, {
    config: { ...agent.config, reflection: next },
  });
  return getReflectionConfig(db, agentId);
}

export function listAgentsWithReflectionEnabled(db: AppDatabase): string[] {
  const rows = db.prepare(`SELECT id, config_json FROM ai_agents WHERE enabled = 1`).all() as Array<{
    id: string;
    config_json: string;
  }>;
  return rows
    .filter((row) => {
      try {
        const cfg = JSON.parse(row.config_json || "{}") as {
          reflection?: Partial<AgentReflectionConfig>;
        };
        return mergeReflection(cfg.reflection).enabled;
      } catch {
        return false;
      }
    })
    .map((r) => r.id);
}
