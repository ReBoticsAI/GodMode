import { v4 as uuidv4 } from "uuid";
import { config } from "../../config.js";
import { getCloudDb } from "../../core-db.js";
import type { AppDatabase } from "../../db.js";
import { getTenantDb, getTenantIdForDb } from "../../tenant-registry.js";
import { ensureUserDb, getUserDb, getUserIdForDb } from "../../user-registry.js";
import { encryptSecret, decryptSecret } from "../holdings/crypto-box.js";
import { getTenantOwnerUserId } from "../user-scope.js";
import { isUserAgentId } from "./user-agent-prompt.js";
import { defaultKnowsUserForAgent } from "./agent-profile-prompt.js";
import {
  DEFAULT_SAMPLING,
  DEFAULT_THINKING,
  type AgentBackendKind,
  type AgentSamplingConfig,
  type AgentThinkingConfig,
  type AiAgent,
  type AiAgentRecord,
} from "./types.js";

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToAgent(row: AiAgentRecord): AiAgent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    backend: row.backend,
    enabled: row.enabled === 1,
    isTemplate: row.is_template === 1,
    systemPrompt: row.system_prompt,
    sampling: parseJson(row.sampling_json, DEFAULT_SAMPLING),
    thinking: parseJson(row.thinking_json, DEFAULT_THINKING),
    toolAllow: parseJson<string[] | null>(row.tool_allow_json, null),
    autoApprove: parseJson(row.auto_approve_json, []),
    modelPath: row.model_path,
    adapterIds: parseJson(row.adapter_ids_json, []),
    config: parseJson(row.config_json, {}),
    parentId: row.parent_id ?? null,
    team: row.team ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Legacy contractor agents superseded by Intelligence coding harness parity. */
export const DEPRECATED_BUILTIN_AGENT_IDS = ["cursor", "pi"] as const;

const DEPRECATED_AGENT_ID_SET = new Set<string>(DEPRECATED_BUILTIN_AGENT_IDS);

export function listAgents(db: AppDatabase): AiAgent[] {
  const rows = db
    .prepare(
      `SELECT * FROM ai_agents ORDER BY is_template DESC, name ASC`
    )
    .all() as AiAgentRecord[];
  return rows
    .map(rowToAgent)
    .filter((a) => !DEPRECATED_AGENT_ID_SET.has(a.id));
}

export function getAgent(db: AppDatabase, id: string): AiAgent | null {
  const row = db.prepare(`SELECT * FROM ai_agents WHERE id = ?`).get(id) as
    | AiAgentRecord
    | undefined;
  return row ? rowToAgent(row) : null;
}

/**
 * Description for the built-in Intelligence assistant. Explains that it's the
 * platform-level AI for GodMode itself and for building things, and how it
 * differs from the user's Digital twin and the specialized subagents.
 */
export const INTELLIGENCE_DESCRIPTION =
  "Intelligence is GodMode's built-in AI — your guide to the platform itself. " +
  "Ask it how GodMode works and have it help you build and wire things up: " +
  "new agents, pages, departments, automations and workflows. " +
  "It has a platform-wide view, so it's the best place to start when you're " +
  "setting something up or aren't sure which specialized agent to use. " +
  "For focused, ongoing work, hand off to a subagent that oversees a specific " +
  "area of GodMode (e.g. Research or Content). " +
  "Refine its behavior anytime from its Agent Profile in Agents > Pipeline.";

/**
 * Whether the Intelligence agent's description is still an auto-generated
 * default (safe to refresh) rather than something the user has customized.
 */
function isDefaultIntelligenceDescription(description: string | null): boolean {
  if (!description) return true;
  const trimmed = description.trim();
  if (trimmed === "") return true;
  if (trimmed === "Default platform assistant template") return true;
  if (trimmed.includes("is GodMode's built-in AI")) return true;
  return false;
}

/**
 * Idempotent: upgrade the Intelligence agent's default description to the
 * current copy, without clobbering a description the user has edited.
 */
export function ensureIntelligenceDescription(db: AppDatabase): void {
  const row = db
    .prepare(`SELECT description FROM ai_agents WHERE id='intelligence'`)
    .get() as { description: string | null } | undefined;
  if (!row) return;
  if (!isDefaultIntelligenceDescription(row.description)) return;
  db.prepare(
    `UPDATE ai_agents SET description=?, updated_at=datetime('now') WHERE id='intelligence'`
  ).run(INTELLIGENCE_DESCRIPTION);
}

/**
 * Generated default description for a specialized subagent. Explains that it
 * oversees a focused area of GodMode and how it differs from Intelligence and
 * the user's Digital twin. Users can extend this from the Agent Profile editor.
 */
export function defaultSubagentDescription(name: string): string {
  const n = name.trim() || "This agent";
  return (
    `${n} is a specialized GodMode subagent. ` +
    `It oversees a specific area of the platform and handles the focused work ` +
    `there — tasks, monitoring and day-to-day execution — so you don't have to. ` +
    `It works under Intelligence and alongside your other agents, and only ` +
    `knows what it's been given (its context, saved memories and past ` +
    `conversations), so it can be wrong or out of date; treat its replies as a ` +
    `specialist's input, not a final decision. ` +
    `Refine its role, knowledge and limits anytime from its Agent Profile in ` +
    `Agents > Pipeline.`
  );
}

/**
 * Whether an agent's description is still an auto-generated default (safe to
 * refresh) rather than something the user has customized. Treats the legacy
 * template text and the Intelligence blurb (historically inherited on create)
 * as defaults too.
 */
function isDefaultSubagentDescription(description: string | null): boolean {
  if (!description) return true;
  const t = description.trim();
  if (t === "") return true;
  if (t === "Default platform assistant template") return true;
  if (t === INTELLIGENCE_DESCRIPTION) return true;
  if (t.includes("is GodMode's built-in AI")) return true;
  if (t.includes("is a specialized GodMode subagent")) return true;
  // Legacy auto-seeded page-owner blurbs (e.g. "Owns the Markets page.").
  if (/^owns the .+/i.test(t)) return true;
  return false;
}

/**
 * Idempotent: backfill a generated description on every non-special agent
 * (everything except the Intelligence root and the user persona twins, which
 * have their own copy) whose description is still an auto-generated default.
 * Never clobbers a description the user has edited.
 */
export function ensureAgentDescriptions(db: AppDatabase): void {
  const rows = db
    .prepare(
      `SELECT id, name, description FROM ai_agents
       WHERE id <> 'intelligence' AND id NOT LIKE 'user-%'`
    )
    .all() as Array<{ id: string; name: string; description: string | null }>;
  for (const row of rows) {
    if (!isDefaultSubagentDescription(row.description)) continue;
    db.prepare(
      `UPDATE ai_agents SET description=?, updated_at=datetime('now') WHERE id=?`
    ).run(defaultSubagentDescription(row.name), row.id);
  }
}

/** Hub/client default: cloud provider unless an external llama-server is attached. */
function defaultIntelligenceBackend(): AgentBackendKind {
  if (config.ai.external) return "local";
  if (config.isHub || config.isClient) return "provider";
  return "local";
}

export function seedIntelligenceAgent(db: AppDatabase): void {
  const existing = db
    .prepare(`SELECT id FROM ai_agents WHERE id IN ('intelligence', 'intelligence')`)
    .get();
  if (existing) return;
  const sampling: AgentSamplingConfig = {
    temperature: config.ai.defaultTemperature,
    topP: config.ai.defaultTopP,
    topK: config.ai.defaultTopK,
    minP: config.ai.defaultMinP,
    repeatPenalty: config.ai.defaultRepeatPenalty,
    presencePenalty: config.ai.defaultPresencePenalty,
    frequencyPenalty: config.ai.defaultFrequencyPenalty,
    maxTokens: config.ai.defaultMaxTokens,
    seed: config.ai.defaultSeed,
  };
  const thinking: AgentThinkingConfig = {
    enableThinking: config.ai.defaultEnableThinking,
    thinkingEfficiency: config.ai.defaultThinkingEfficiency,
    nativeTools: config.ai.defaultNativeTools,
  };
  const defaultBackend = defaultIntelligenceBackend();
  const defaultConfig =
    defaultBackend === "provider"
      ? { knowsUser: true, codeAccess: true, provider: "openai", model: "gpt-4o" }
      : { knowsUser: true, codeAccess: true };
  db.prepare(
    `INSERT INTO ai_agents (
      id, name, description, icon, backend, enabled, is_template,
      system_prompt, sampling_json, thinking_json, tool_allow_json,
      auto_approve_json, model_path, adapter_ids_json, config_json
    ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, NULL, '[]', NULL, '[]', '{}')`
  ).run(
    "intelligence",
    "Intelligence",
    INTELLIGENCE_DESCRIPTION,
    "sparkles",
    defaultBackend,
    config.ai.defaultSystemPrompt,
    JSON.stringify(sampling),
    JSON.stringify(thinking)
  );
  db.prepare(`UPDATE ai_agents SET config_json=? WHERE id='intelligence' AND config_json='{}'`).run(
    JSON.stringify(defaultConfig)
  );
}

/** Idempotent: when LLAMA_EXTERNAL is set, Intelligence must use local llama, not provider keys. */
export function ensureIntelligenceLocalBackendWhenExternalLlm(db: AppDatabase): void {
  if (!config.ai.external) return;
  const row = db
    .prepare(`SELECT backend, config_json FROM ai_agents WHERE id='intelligence'`)
    .get() as { backend: string; config_json: string } | undefined;
  if (!row || row.backend === "local") return;
  if (row.backend !== "provider") return;

  let agentConfig: Record<string, unknown> = {};
  try {
    agentConfig = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
  } catch {
    agentConfig = {};
  }
  const nextConfig = {
    knowsUser: agentConfig.knowsUser !== false,
    codeAccess: agentConfig.codeAccess !== false,
  };
  db.prepare(
    `UPDATE ai_agents
     SET backend='local', config_json=?, model_path=NULL, updated_at=datetime('now')
     WHERE id='intelligence'`
  ).run(JSON.stringify(nextConfig));
}

/** Whether an agent may use coding/terminal tools (read_file, run_terminal, etc.). */
export function agentCodeAccess(agent: AiAgent | null | undefined): boolean {
  if (!agent) return false;
  // SaaS: deny coding/terminal tools unless platform policy explicitly enables them.
  if (config.isSaas && !config.saasAllowCodeAccess) return false;
  if (agent.id === "intelligence") return true;
  return agent.config?.codeAccess === true;
}

/** Code autonomy profile for coding tools (Cursor YOLO equivalent). */
export type CodeAutonomyLevel = "off" | "writes" | "full";

export function agentCodeAutonomyLevel(
  agent: AiAgent | null | undefined
): CodeAutonomyLevel {
  if (!agent) return "off";
  const v = agent.config?.codeAutonomy;
  if (v === true || v === "full") return "full";
  if (v === "writes") return "writes";
  return "off";
}

/** When true, coding/terminal confirm tools auto-run without a UI prompt. */
export function agentCodeAutonomy(agent: AiAgent | null | undefined): boolean {
  return agentCodeAutonomyLevel(agent) !== "off";
}

const WORKING_AGENT_IDS = ["intelligence"] as const;

const SPECIALIST_CODE_ACCESS_IDS = new Set<string>(WORKING_AGENT_IDS);

/**
 * Safe planning/notification tools that may run without a confirm dialog on
 * working agents. Also includes the sim-only backtest + automation tools that
 * power the autonomous backtest-iterate / self-loop pattern. Live-order tools
 * (deploy_playbook, flatten_*) are intentionally excluded — they stay in
 * NEVER_AUTO_APPROVE so nothing can fire live orders unattended.
 */
const AUTONOMOUS_AUTO_APPROVE_TOOLS = [
  "todo_write",
  "comment_card",
  "add_card_comment",
  "get_playbooks",
  "list_project_cards",
  "create_notification",
  "list_notifications",
  "mark_notification_read",
  "use_skill",
  "run_workflow",
  "emit_event",
  "create_hook",
  "update_hook",
  "delete_hook",
  "create_schedule",
  "create_workflow",
  "update_workflow",
] as const;

/** Idempotent: merge autonomous auto-approve tools into working agents (never removes user entries). */
export function ensureAgentAutoApproveDefaults(db: AppDatabase): void {
  for (const agentId of WORKING_AGENT_IDS) {
    const row = db
      .prepare(`SELECT auto_approve_json FROM ai_agents WHERE id = ?`)
      .get(agentId) as { auto_approve_json: string | null } | undefined;
    if (!row) continue;
    const current = parseJson<string[]>(row.auto_approve_json, []);
    if (current.includes("*")) continue;
    const merged = [...new Set([...current, ...AUTONOMOUS_AUTO_APPROVE_TOOLS])];
    if (merged.length === current.length) continue;
    db.prepare(
      `UPDATE ai_agents SET auto_approve_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(merged), agentId);
  }
}

/** Idempotent: reflection auto + idle for working agents; upgrade persona agents to auto. */
export function ensureAgentReflectionDefaults(db: AppDatabase): void {
  for (const row of db
    .prepare(`SELECT id, config_json FROM ai_agents WHERE enabled = 1`)
    .all() as Array<{ id: string; config_json: string }>) {
    if (DEPRECATED_AGENT_ID_SET.has(row.id)) continue;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    } catch {
      config = {};
    }
    const raw = (config.reflection ?? {}) as Record<string, unknown>;
    const isWorking = (WORKING_AGENT_IDS as readonly string[]).includes(row.id);
    const isPersona = row.id.startsWith("user-");

    if (isWorking) {
      const next = {
        enabled: true,
        mode: "auto",
        schedule: {
          enabled: row.id === "intelligence",
          cron: "0 2 * * *",
          timezone: "America/Denver",
        },
        idle: { enabled: true, afterMinutes: 30 },
        lastRunAt: raw.lastRunAt ?? null,
        lastSummary: raw.lastSummary ?? null,
        watermark: raw.watermark ?? null,
      };
      if (
        raw.enabled === next.enabled &&
        raw.mode === next.mode &&
        (raw.schedule as { enabled?: boolean } | undefined)?.enabled === next.schedule.enabled
      ) {
        continue;
      }
      config.reflection = next;
    } else if (isPersona && raw.enabled === true && raw.mode !== "auto") {
      config.reflection = { ...raw, mode: "auto" };
    } else {
      continue;
    }

    db.prepare(`UPDATE ai_agents SET config_json=?, updated_at=datetime('now') WHERE id=?`).run(
      JSON.stringify(config),
      row.id
    );
  }
}

/** Idempotent: grant codeAccess to specialist page-owner agents. */
export function ensureSpecialistCodeAccess(db: AppDatabase): void {
  for (const agentId of SPECIALIST_CODE_ACCESS_IDS) {
    const row = db
      .prepare(`SELECT config_json FROM ai_agents WHERE id = ?`)
      .get(agentId) as { config_json: string } | undefined;
    if (!row) continue;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    } catch {
      config = {};
    }
    if (config.codeAccess === true) continue;
    config.codeAccess = true;
    db.prepare(`UPDATE ai_agents SET config_json=?, updated_at=datetime('now') WHERE id=?`).run(
      JSON.stringify(config),
      agentId
    );
  }
}

/** Idempotent: grant Intelligence codeAccess for existing installs. */
export function ensureIntelligenceCodeAccess(db: AppDatabase): void {
  const row = db
    .prepare(`SELECT config_json FROM ai_agents WHERE id='intelligence'`)
    .get() as { config_json: string } | undefined;
  if (!row) return;
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
  } catch {
    config = {};
  }
  if (config.codeAccess === true) return;
  config.codeAccess = true;
  db.prepare(`UPDATE ai_agents SET config_json=?, updated_at=datetime('now') WHERE id='intelligence'`).run(
    JSON.stringify(config)
  );
}

const DEPRECATED_AGENT_REASSIGN_SQL = [
  `UPDATE ai_memories SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_workflows SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_projects SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_project_cards SET assigned_agent_id = 'intelligence' WHERE assigned_agent_id = ?`,
  `UPDATE ai_calendar_events SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_agent_rule_state SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_agent_skill_state SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_artifacts SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_reflection_proposals SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_agent_assignments SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE platform_action_log SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_rules SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_skills SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_prompts SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE ai_agent_accounts SET agent_id = 'intelligence' WHERE agent_id = ?`,
  `UPDATE events SET actor_agent_id = 'intelligence' WHERE actor_agent_id = ?`,
  `UPDATE ai_agents SET parent_id = 'intelligence' WHERE parent_id = ?`,
  `UPDATE structure_nodes SET agent_id = NULL WHERE agent_id = ?`,
  `DELETE FROM ai_capability_embeddings WHERE agent_id = ?`,
] as const;

/**
 * Idempotent: remove legacy Cursor/Pi contractor agents now that Intelligence
 * implements the coding harness natively.
 */
export function removeDeprecatedBuiltinAgents(db: AppDatabase): void {
  for (const id of DEPRECATED_BUILTIN_AGENT_IDS) {
    const row = db.prepare(`SELECT id FROM ai_agents WHERE id = ?`).get(id);
    if (!row) continue;
    const tx = db.transaction(() => {
      for (const sql of DEPRECATED_AGENT_REASSIGN_SQL) {
        try {
          db.prepare(sql).run(id);
        } catch {
          /* table/column may not exist on older schemas */
        }
      }
      db.prepare(`DELETE FROM ai_agents WHERE id = ?`).run(id);
    });
    tx();
  }
}

/** Idempotent: set knowsUser defaults on intelligence and existing user-* agents. */
export function ensureAgentPrincipalDefaults(db: AppDatabase): void {
  for (const row of db
    .prepare(`SELECT id, config_json FROM ai_agents WHERE id='intelligence' OR id LIKE 'user-%'`)
    .all() as Array<{ id: string; config_json: string }>) {
    if (!defaultKnowsUserForAgent(row.id)) continue;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
    } catch {
      config = {};
    }
    if (typeof config.knowsUser === "boolean") continue;
    config.knowsUser = true;
    db.prepare(`UPDATE ai_agents SET config_json=?, updated_at=datetime('now') WHERE id=?`).run(
      JSON.stringify(config),
      row.id
    );
  }
}

export function createAgent(
  db: AppDatabase,
  input: {
    id?: string;
    name: string;
    description?: string;
    icon?: string;
    backend?: AgentBackendKind;
    systemPrompt?: string;
    sampling?: Partial<AgentSamplingConfig>;
    thinking?: Partial<AgentThinkingConfig>;
    toolAllow?: string[] | null;
    autoApprove?: string[];
    modelPath?: string | null;
    adapterIds?: string[];
    config?: Record<string, unknown>;
    cloneFromId?: string;
    parentId?: string | null;
    team?: string | null;
  }
): AiAgent {
  let base = getAgent(db, "intelligence");
  if (input.cloneFromId) {
    const src = getAgent(db, input.cloneFromId);
    if (src) base = src;
  }
  const id = input.id ?? uuidv4();
  const sampling = { ...(base?.sampling ?? DEFAULT_SAMPLING), ...input.sampling };
  const thinking = { ...(base?.thinking ?? DEFAULT_THINKING), ...input.thinking };
  db.prepare(
    `INSERT INTO ai_agents (
      id, name, description, icon, backend, enabled, is_template,
      system_prompt, sampling_json, thinking_json, tool_allow_json,
      auto_approve_json, model_path, adapter_ids_json, config_json,
      parent_id, team
    ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    // Don't inherit the base/template (Intelligence) description — generate a
    // sensible specialized-subagent default when the caller didn't supply one.
    input.description ?? defaultSubagentDescription(input.name),
    input.icon ?? base?.icon ?? null,
    input.backend ?? base?.backend ?? "local",
    input.systemPrompt ?? base?.systemPrompt ?? config.ai.defaultSystemPrompt,
    JSON.stringify(sampling),
    JSON.stringify(thinking),
    input.toolAllow != null
      ? JSON.stringify(input.toolAllow)
      : base?.toolAllow != null
        ? JSON.stringify(base.toolAllow)
        : null,
    JSON.stringify(input.autoApprove ?? base?.autoApprove ?? []),
    input.modelPath ?? base?.modelPath ?? null,
    JSON.stringify(input.adapterIds ?? base?.adapterIds ?? []),
    JSON.stringify({ ...(base?.config ?? {}), ...(input.config ?? {}) }),
    input.parentId ?? null,
    input.team ?? null
  );
  // When cloning, copy the source agent's per-agent rule/skill enable state so
  // the new agent starts with the same toggles (not the default-all-enabled).
  if (input.cloneFromId) {
    try {
      db.prepare(
        `INSERT OR IGNORE INTO ai_agent_rule_state (agent_id, rule_id, enabled, priority_override, updated_at)
         SELECT ?, rule_id, enabled, priority_override, datetime('now')
         FROM ai_agent_rule_state WHERE agent_id = ?`
      ).run(id, input.cloneFromId);
      db.prepare(
        `INSERT OR IGNORE INTO ai_agent_skill_state (agent_id, skill_id, enabled, last_used_at, updated_at)
         SELECT ?, skill_id, enabled, last_used_at, datetime('now')
         FROM ai_agent_skill_state WHERE agent_id = ?`
      ).run(id, input.cloneFromId);
    } catch {
      /* per-agent state tables optional during early migration */
    }
  }
  return getAgent(db, id)!;
}

export function updateAgent(
  db: AppDatabase,
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    icon: string | null;
    backend: AgentBackendKind;
    enabled: boolean;
    systemPrompt: string;
    sampling: AgentSamplingConfig;
    thinking: AgentThinkingConfig;
    toolAllow: string[] | null;
    autoApprove: string[];
    modelPath: string | null;
    adapterIds: string[];
    config: Record<string, unknown>;
    parentId: string | null;
    team: string | null;
  }>
): AiAgent | null {
  const cur = getAgent(db, id);
  if (!cur) return null;
  if (patch.name != null)
    db.prepare(`UPDATE ai_agents SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(
      patch.name,
      id
    );
  if (patch.description !== undefined)
    db.prepare(
      `UPDATE ai_agents SET description = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.description, id);
  if (patch.icon !== undefined)
    db.prepare(`UPDATE ai_agents SET icon = ?, updated_at = datetime('now') WHERE id = ?`).run(
      patch.icon,
      id
    );
  if (patch.backend != null)
    db.prepare(`UPDATE ai_agents SET backend = ?, updated_at = datetime('now') WHERE id = ?`).run(
      patch.backend,
      id
    );
  if (patch.enabled != null)
    db.prepare(`UPDATE ai_agents SET enabled = ?, updated_at = datetime('now') WHERE id = ?`).run(
      patch.enabled ? 1 : 0,
      id
    );
  if (patch.systemPrompt != null)
    db.prepare(
      `UPDATE ai_agents SET system_prompt = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.systemPrompt, id);
  if (patch.sampling != null)
    db.prepare(
      `UPDATE ai_agents SET sampling_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(patch.sampling), id);
  if (patch.thinking != null)
    db.prepare(
      `UPDATE ai_agents SET thinking_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(patch.thinking), id);
  if (patch.toolAllow !== undefined)
    db.prepare(
      `UPDATE ai_agents SET tool_allow_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.toolAllow == null ? null : JSON.stringify(patch.toolAllow), id);
  if (patch.autoApprove != null)
    db.prepare(
      `UPDATE ai_agents SET auto_approve_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(patch.autoApprove), id);
  if (patch.modelPath !== undefined)
    db.prepare(
      `UPDATE ai_agents SET model_path = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(patch.modelPath, id);
  if (patch.adapterIds != null)
    db.prepare(
      `UPDATE ai_agents SET adapter_ids_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(patch.adapterIds), id);
  if (patch.config != null)
    db.prepare(
      `UPDATE ai_agents SET config_json = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify(patch.config), id);
  if (patch.parentId !== undefined) {
    if (id === "intelligence" && patch.parentId !== null) {
      /* intelligence stays root in DB */
    } else if (!isUserAgentId(id) || patch.parentId === null) {
      db.prepare(
        `UPDATE ai_agents SET parent_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(patch.parentId, id);
    }
  }
  if (patch.team !== undefined)
    db.prepare(`UPDATE ai_agents SET team = ?, updated_at = datetime('now') WHERE id = ?`).run(
      patch.team,
      id
    );
  return getAgent(db, id);
}

export function deleteAgent(db: AppDatabase, id: string): boolean {
  if (id === "intelligence" || id.startsWith("user-")) return false;
  return db.prepare(`DELETE FROM ai_agents WHERE id = ?`).run(id).changes > 0;
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export type VaultOwnerKind = "platform" | "user" | "agent";

export type VaultOwner =
  | { kind: "platform" }
  | { kind: "user" }
  | { kind: "agent"; agentId: string };

export interface AiSecretRow {
  id: string;
  name: string;
  value: string;
  agent_id: string | null;
  owner_kind: VaultOwnerKind;
  created_at: string;
}

export type VaultSecretListItem = {
  id: string;
  name: string;
  masked: string;
  createdAt: string;
  agentId: string | null;
  ownerKind: VaultOwnerKind;
};

/** Normalize agent id; empty → null. */
export function normalizeVaultAgentId(agentId?: string | null): string | null {
  if (agentId == null) return null;
  const trimmed = String(agentId).trim();
  return trimmed ? trimmed : null;
}

/**
 * Map Connect-card scope: omitted/null agentId → Platform Vault (platform kind);
 * set agentId → that Agent Vault. Never Personal Vault (owner_kind=user) for LLM/Exa.
 */
export function vaultOwnerFromAgentScope(agentId?: string | null): VaultOwner {
  const scope = normalizeVaultAgentId(agentId);
  return scope ? { kind: "agent", agentId: scope } : { kind: "platform" };
}

export function parseVaultOwnerKind(
  raw: unknown
): VaultOwnerKind | null {
  if (raw === "platform" || raw === "user" || raw === "agent") return raw;
  return null;
}

/** Build a VaultOwner from API query/body fields. */
export function resolveVaultOwnerInput(opts: {
  ownerKind?: unknown;
  agentId?: unknown;
}): VaultOwner {
  const kind =
    parseVaultOwnerKind(opts.ownerKind) ??
    (normalizeVaultAgentId(
      typeof opts.agentId === "string" ? opts.agentId : null
    )
      ? "agent"
      : "platform");
  if (kind === "agent") {
    const agentId = normalizeVaultAgentId(
      typeof opts.agentId === "string" ? opts.agentId : null
    );
    if (!agentId) {
      throw new Error("agentId is required when owner_kind is agent");
    }
    return { kind: "agent", agentId };
  }
  return { kind };
}

/** Stable primary key for fixed Connect-card secrets (Platform or Agent). */
export function platformVaultSecretId(
  baseId: string,
  agentId?: string | null
): string {
  const scope = normalizeVaultAgentId(agentId);
  return scope ? `${baseId}__agent__${scope}` : baseId;
}

/** Decrypt ciphertext. Fail closed via tryReadSecretPlain for resolve paths. */
function tryReadSecretPlain(value: string): string | null {
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

/**
 * Run `fn` with a resolved plaintext secret without exposing it on a casual
 * return path. Callers must not log, serialize, or put `value` into model context.
 */
export function withSecretValue<T>(
  plain: string | null | undefined,
  fn: (value: string) => T
): T {
  if (plain == null || plain === "") {
    throw new Error("Secret value is missing");
  }
  return fn(plain);
}

function assertVaultOwner(owner: VaultOwner): VaultOwner {
  if (owner.kind === "agent") {
    const agentId = normalizeVaultAgentId(owner.agentId);
    if (!agentId) throw new Error("agentId is required for agent Vault");
    return { kind: "agent", agentId };
  }
  return owner;
}

function secretOwnerClause(owner: VaultOwner): {
  sql: string;
  params: string[];
  kind: VaultOwnerKind;
  agentId: string | null;
} {
  const o = assertVaultOwner(owner);
  if (o.kind === "agent") {
    return {
      sql: "owner_kind = 'agent' AND agent_id = ?",
      params: [o.agentId],
      kind: "agent",
      agentId: o.agentId,
    };
  }
  return {
    sql: "owner_kind = ? AND agent_id IS NULL",
    params: [o.kind],
    kind: o.kind,
    agentId: null,
  };
}

function ownerLabel(owner: VaultOwner): string {
  if (owner.kind === "agent") return "this agent Vault";
  if (owner.kind === "user") return "the Personal Vault";
  return "the Platform Vault";
}

function toListItem(r: AiSecretRow): VaultSecretListItem {
  const plain = tryReadSecretPlain(r.value);
  return {
    id: r.id,
    name: r.name,
    masked: plain ? maskSecret(plain) : "••••••••",
    createdAt: r.created_at,
    agentId: r.agent_id ?? null,
    ownerKind: r.owner_kind,
  };
}

/** List secrets for one Vault owner (platform, user, or a single agent). */
export function listSecrets(
  db: AppDatabase,
  owner: VaultOwner | string | null | undefined = { kind: "platform" },
  userId?: string | null
): VaultSecretListItem[] {
  const resolved =
    typeof owner === "string" || owner == null
      ? vaultOwnerFromAgentScope(owner)
      : owner;
  const clause = secretOwnerClause(resolved);
  const rows = db
    .prepare(
      `SELECT id, name, value, agent_id, owner_kind, created_at FROM ai_secrets
       WHERE ${clause.sql}
       ORDER BY name`
    )
    .all(...clause.params) as AiSecretRow[];
  const items = rows.map(toListItem);
  if (resolved.kind !== "platform") return items;

  const accountId = resolveVaultAccountUserId(db, userId);
  if (!accountId) return items;
  try {
    ensureUserDb(accountId);
    const userRows = getUserDb(accountId)
      .prepare(
        `SELECT id, name, value, agent_id, owner_kind, created_at FROM ai_secrets
         WHERE owner_kind = 'platform' AND agent_id IS NULL
         ORDER BY name`
      )
      .all() as AiSecretRow[];
    const seen = new Set(items.map((i) => i.name.toLowerCase()));
    for (const row of userRows) {
      if (seen.has(row.name.toLowerCase())) continue;
      items.push(toListItem(row));
      seen.add(row.name.toLowerCase());
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    /* User DB optional until first ensure */
  }
  return items;
}

export function getSecretRow(
  db: AppDatabase,
  id: string
): AiSecretRow | null {
  const row = db
    .prepare(
      `SELECT id, name, value, agent_id, owner_kind, created_at FROM ai_secrets WHERE id = ?`
    )
    .get(id) as AiSecretRow | undefined;
  return row ?? null;
}

export function getSecretValue(db: AppDatabase, id: string): string | null {
  const row = getSecretRow(db, id);
  if (!row) return null;
  return tryReadSecretPlain(row.value);
}

/**
 * Read a secret by id when it belongs to the agent Vault or Platform Vault.
 * Blocks cross-agent and User-Vault reads for agent resolve paths.
 */
export function getSecretValueForAgent(
  db: AppDatabase,
  id: string,
  agentId: string
): string | null {
  const row = getSecretRow(db, id);
  if (!row) return null;
  if (row.owner_kind === "agent" && row.agent_id !== agentId) return null;
  if (row.owner_kind === "user") return null;
  return tryReadSecretPlain(row.value);
}

export function findSecretByName(
  db: AppDatabase,
  name: string,
  owner: VaultOwner | string | null | undefined = { kind: "platform" }
): AiSecretRow | null {
  const resolved =
    typeof owner === "string" || owner == null
      ? vaultOwnerFromAgentScope(owner)
      : owner;
  const clause = secretOwnerClause(resolved);
  const row = db
    .prepare(
      `SELECT id, name, value, agent_id, owner_kind, created_at FROM ai_secrets
       WHERE LOWER(name) = LOWER(?) AND ${clause.sql}
       LIMIT 1`
    )
    .get(name, ...clause.params) as AiSecretRow | undefined;
  return row ?? null;
}

/**
 * Account userId for Platform Vault fallthrough: explicit, User DB identity, or
 * Workspace DB owner. Never Personal Vault (owner_kind=user).
 */
export function resolveVaultAccountUserId(
  db: AppDatabase,
  explicitUserId?: string | null
): string | null {
  const trimmed = explicitUserId?.trim();
  if (trimmed) return trimmed;
  const fromUserDb = getUserIdForDb(db);
  if (fromUserDb) return fromUserDb;
  const tenantId = getTenantIdForDb(db);
  if (!tenantId) return null;
  return getTenantOwnerUserId(tenantId);
}

function readPlatformPlain(
  db: AppDatabase,
  baseId: string,
  name: string
): string | null {
  const byId = getSecretValue(db, platformVaultSecretId(baseId, null));
  if (byId) return byId;
  const byName = findSecretByName(db, name, { kind: "platform" });
  return byName ? tryReadSecretPlain(byName.value) : null;
}

/**
 * Lazy-migrate a Connect secret from owned Workspace DBs into the User DB.
 * Idempotent; never crosses accounts.
 */
export function migrateConnectSecretToUserVault(
  userId: string,
  baseId: string,
  name: string
): string | null {
  const userDb = getUserDb(userId);
  const existing = readPlatformPlain(userDb, baseId, name);
  if (existing) return existing;

  const tenants = getCloudDb()
    .prepare(
      `SELECT id FROM tenants
       WHERE owner_user_id = ? AND is_operator = 0
       ORDER BY updated_at DESC`
    )
    .all(userId) as Array<{ id: string }>;

  for (const t of tenants) {
    let workspaceDb: AppDatabase;
    try {
      workspaceDb = getTenantDb(t.id);
    } catch {
      continue;
    }
    const value = readPlatformPlain(workspaceDb, baseId, name);
    if (!value?.trim()) continue;
    writePlatformSecretRow(userDb, {
      baseId,
      name,
      value,
      agentId: null,
    });
    return value;
  }
  return null;
}

function resolveFromUserVault(
  userId: string,
  opts: { baseId: string; name: string }
): string | null {
  ensureUserDb(userId);
  const migrated = migrateConnectSecretToUserVault(
    userId,
    opts.baseId,
    opts.name
  );
  if (migrated) return migrated;
  return readPlatformPlain(getUserDb(userId), opts.baseId, opts.name);
}

function resolveNameFromUserVault(userId: string, name: string): string | null {
  ensureUserDb(userId);
  const userDb = getUserDb(userId);
  const row = findSecretByName(userDb, name, { kind: "platform" });
  if (row) {
    const plain = tryReadSecretPlain(row.value);
    if (plain) return plain;
  }
  const tenants = getCloudDb()
    .prepare(
      `SELECT id FROM tenants
       WHERE owner_user_id = ? AND is_operator = 0
       ORDER BY updated_at DESC`
    )
    .all(userId) as Array<{ id: string }>;
  for (const t of tenants) {
    let workspaceDb: AppDatabase;
    try {
      workspaceDb = getTenantDb(t.id);
    } catch {
      continue;
    }
    const wsRow = findSecretByName(workspaceDb, name, { kind: "platform" });
    if (!wsRow) continue;
    const value = tryReadSecretPlain(wsRow.value);
    if (!value?.trim()) continue;
    writePlatformSecretRow(userDb, {
      baseId: wsRow.id,
      name: wsRow.name,
      value,
      agentId: null,
    });
    return value;
  }
  return null;
}

function writePlatformSecretRow(
  db: AppDatabase,
  opts: { baseId: string; name: string; value: string; agentId?: string | null }
): void {
  const trimmed = opts.value.trim();
  if (!trimmed) throw new Error("API key required");
  const owner = vaultOwnerFromAgentScope(opts.agentId);
  const scope = owner.kind === "agent" ? owner.agentId : null;
  const rowId = platformVaultSecretId(opts.baseId, scope);
  const clause = secretOwnerClause(owner);
  db.prepare(
    `DELETE FROM ai_secrets WHERE ${clause.sql} AND (id = ? OR LOWER(name) = LOWER(?))`
  ).run(...clause.params, rowId, opts.name);
  db.prepare(
    `INSERT INTO ai_secrets (id, name, value, agent_id, owner_kind) VALUES (?, ?, ?, ?, ?)`
  ).run(rowId, opts.name, encryptSecret(trimmed), clause.agentId, clause.kind);
}

/**
 * Resolve by name: agent Vault → Workspace platform → Platform Vault (account).
 * Never falls back to Personal Vault (owner_kind=user). No cross-agent reads.
 */
export function resolveSecretByName(
  db: AppDatabase,
  name: string,
  agentId?: string | null,
  userId?: string | null
): string | null {
  const scope = normalizeVaultAgentId(agentId);
  if (scope) {
    const agentRow = findSecretByName(db, name, {
      kind: "agent",
      agentId: scope,
    });
    if (agentRow) return tryReadSecretPlain(agentRow.value);
  }
  const platform = findSecretByName(db, name, { kind: "platform" });
  if (platform) return tryReadSecretPlain(platform.value);
  const accountId = resolveVaultAccountUserId(db, userId);
  if (!accountId) return null;
  return resolveNameFromUserVault(accountId, name);
}

/**
 * Resolve a fixed Connect-card secret (by stable base id + name).
 * Agent Vault → Workspace platform override → Platform Vault (account User DB).
 * Never Personal Vault (owner_kind=user).
 */
export function resolvePlatformVaultSecret(
  db: AppDatabase,
  opts: {
    baseId: string;
    name: string;
    agentId?: string | null;
    userId?: string | null;
  }
): string | null {
  const scope = normalizeVaultAgentId(opts.agentId);
  if (scope) {
    const byScopedId = getSecretValue(
      db,
      platformVaultSecretId(opts.baseId, scope)
    );
    if (byScopedId) return byScopedId;
    const byName = findSecretByName(db, opts.name, {
      kind: "agent",
      agentId: scope,
    });
    if (byName) return tryReadSecretPlain(byName.value);
  }
  const platformById = getSecretValue(
    db,
    platformVaultSecretId(opts.baseId, null)
  );
  if (platformById) return platformById;
  const platformByName = findSecretByName(db, opts.name, { kind: "platform" });
  if (platformByName) return tryReadSecretPlain(platformByName.value);

  const accountId = resolveVaultAccountUserId(db, opts.userId);
  if (!accountId) return null;
  return resolveFromUserVault(accountId, {
    baseId: opts.baseId,
    name: opts.name,
  });
}

/**
 * Status lookup for one owner. Agent scope stays agent-only.
 * Platform scope also checks Platform Vault (account) after Workspace override.
 */
export function getPlatformVaultSecretInScope(
  db: AppDatabase,
  opts: {
    baseId: string;
    name: string;
    agentId?: string | null;
    userId?: string | null;
  }
): string | null {
  const owner = vaultOwnerFromAgentScope(opts.agentId);
  const scope = owner.kind === "agent" ? owner.agentId : null;
  const byId = getSecretValue(db, platformVaultSecretId(opts.baseId, scope));
  if (byId) return byId;
  const byName = findSecretByName(db, opts.name, owner);
  if (byName) return tryReadSecretPlain(byName.value);
  if (owner.kind === "agent") return null;
  const accountId = resolveVaultAccountUserId(db, opts.userId);
  if (!accountId) return null;
  return resolveFromUserVault(accountId, {
    baseId: opts.baseId,
    name: opts.name,
  });
}

/**
 * Upsert Connect secret. Default (no agentId): Platform Vault when account is known.
 * Pass workspaceOnly to write a Workspace platform override instead.
 * Agent scope always writes the Workspace Agent Vault.
 */
export function upsertPlatformVaultSecret(
  db: AppDatabase,
  opts: {
    baseId: string;
    name: string;
    value: string;
    agentId?: string | null;
    userId?: string | null;
    workspaceOnly?: boolean;
  }
): void {
  if (opts.agentId) {
    writePlatformSecretRow(db, opts);
    return;
  }
  const accountId = resolveVaultAccountUserId(db, opts.userId);
  if (!accountId || opts.workspaceOnly) {
    writePlatformSecretRow(db, { ...opts, agentId: null });
    return;
  }
  ensureUserDb(accountId);
  writePlatformSecretRow(getUserDb(accountId), { ...opts, agentId: null });
}

export function removePlatformVaultSecret(
  db: AppDatabase,
  opts: {
    baseId: string;
    name: string;
    agentId?: string | null;
    userId?: string | null;
    workspaceOnly?: boolean;
  }
): boolean {
  if (opts.agentId) {
    const owner = vaultOwnerFromAgentScope(opts.agentId);
    const scope = owner.kind === "agent" ? owner.agentId : null;
    const rowId = platformVaultSecretId(opts.baseId, scope);
    const clause = secretOwnerClause(owner);
    return (
      db
        .prepare(
          `DELETE FROM ai_secrets WHERE ${clause.sql} AND (id = ? OR LOWER(name) = LOWER(?))`
        )
        .run(...clause.params, rowId, opts.name).changes > 0
    );
  }

  let removed = false;
  const wsOwner = vaultOwnerFromAgentScope(null);
  const wsRowId = platformVaultSecretId(opts.baseId, null);
  const wsClause = secretOwnerClause(wsOwner);
  if (
    db
      .prepare(
        `DELETE FROM ai_secrets WHERE ${wsClause.sql} AND (id = ? OR LOWER(name) = LOWER(?))`
      )
      .run(...wsClause.params, wsRowId, opts.name).changes > 0
  ) {
    removed = true;
  }
  if (opts.workspaceOnly) return removed;

  const accountId = resolveVaultAccountUserId(db, opts.userId);
  if (!accountId) return removed;
  try {
    const userDb = getUserDb(accountId);
    if (
      userDb
        .prepare(
          `DELETE FROM ai_secrets WHERE ${wsClause.sql} AND (id = ? OR LOWER(name) = LOWER(?))`
        )
        .run(...wsClause.params, wsRowId, opts.name).changes > 0
    ) {
      removed = true;
    }
  } catch {
    /* ignore */
  }
  return removed;
}

/**
 * Resolve apiKeyRef for a running agent: scoped id, direct id (agent/platform),
 * then name in agent → Platform.
 */
export function resolveSecretRefForAgent(
  db: AppDatabase,
  keyRef: string,
  agentId: string
): string | null {
  const scopedId = platformVaultSecretId(keyRef, agentId);
  const fromScoped = getSecretValueForAgent(db, scopedId, agentId);
  if (fromScoped) return fromScoped;
  const direct = getSecretValueForAgent(db, keyRef, agentId);
  if (direct) return direct;
  return resolveSecretByName(db, keyRef, agentId);
}

export function createSecret(
  db: AppDatabase,
  name: string,
  value: string,
  owner: VaultOwner | string | null | undefined = { kind: "platform" }
): {
  id: string;
  name: string;
  masked: string;
  agentId: string | null;
  ownerKind: VaultOwnerKind;
} {
  const resolved =
    typeof owner === "string" || owner == null
      ? vaultOwnerFromAgentScope(owner)
      : assertVaultOwner(owner);
  const existing = findSecretByName(db, name, resolved);
  if (existing) {
    throw new Error(
      `Secret name "${name}" already exists in ${ownerLabel(resolved)}`
    );
  }
  const clause = secretOwnerClause(resolved);
  const id = uuidv4();
  db.prepare(
    `INSERT INTO ai_secrets (id, name, value, agent_id, owner_kind) VALUES (?, ?, ?, ?, ?)`
  ).run(id, name, encryptSecret(value), clause.agentId, clause.kind);
  return {
    id,
    name,
    masked: maskSecret(value),
    agentId: clause.agentId,
    ownerKind: clause.kind,
  };
}

export function deleteSecret(
  db: AppDatabase,
  id: string,
  owner?: VaultOwner | string | null
): boolean {
  if (arguments.length < 3) {
    // Legacy callers: delete by primary key regardless of owner.
    return db.prepare(`DELETE FROM ai_secrets WHERE id = ?`).run(id).changes > 0;
  }
  const resolved =
    typeof owner === "string" || owner == null
      ? vaultOwnerFromAgentScope(owner)
      : owner;
  const clause = secretOwnerClause(resolved);
  return (
    db
      .prepare(`DELETE FROM ai_secrets WHERE id = ? AND ${clause.sql}`)
      .run(id, ...clause.params).changes > 0
  );
}
