import { v4 as uuidv4 } from "uuid";
import { config } from "../../config.js";
import type { AppDatabase } from "../../db.js";
import { encryptSecret, decryptSecret } from "../holdings/crypto-box.js";
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

export interface AiSecretRow {
  id: string;
  name: string;
  value: string;
  created_at: string;
}

function readSecretPlain(value: string): string {
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}

export function listSecrets(db: AppDatabase): Array<{ id: string; name: string; masked: string; createdAt: string }> {
  const rows = db.prepare(`SELECT id, name, value, created_at FROM ai_secrets ORDER BY name`).all() as AiSecretRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    masked: maskSecret(readSecretPlain(r.value)),
    createdAt: r.created_at,
  }));
}

export function getSecretValue(db: AppDatabase, id: string): string | null {
  const row = db.prepare(`SELECT value FROM ai_secrets WHERE id = ?`).get(id) as
    | { value: string }
    | undefined;
  if (!row) return null;
  return readSecretPlain(row.value);
}

export function createSecret(db: AppDatabase, name: string, value: string): { id: string; name: string; masked: string } {
  const id = uuidv4();
  db.prepare(`INSERT INTO ai_secrets (id, name, value) VALUES (?, ?, ?)`).run(
    id,
    name,
    encryptSecret(value)
  );
  return { id, name, masked: maskSecret(value) };
}

export function deleteSecret(db: AppDatabase, id: string): boolean {
  return db.prepare(`DELETE FROM ai_secrets WHERE id = ?`).run(id).changes > 0;
}
