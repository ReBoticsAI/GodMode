import fs from "node:fs";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { seedIntelligenceAgent, removeDeprecatedBuiltinAgents, ensureAgentPrincipalDefaults, ensureIntelligenceDescription, ensureIntelligenceCodeAccess, ensureIntelligenceLocalBackendWhenExternalLlm, ensureAgentDescriptions, ensureAgentReflectionDefaults, ensureAgentAutoApproveDefaults, ensureSpecialistCodeAccess } from "./services/agents/agents-db.js";
import { configureDbPragmas, logDbConfig, runForeignKeyCheck } from "./services/db-config.js";
import {
  addCol as addColumn,
  registerMigration,
  runPendingMigrations,
  tableExists,
} from "./services/db-migrations.js";
import { registerDataManagementMigrations, ensureCapabilityTables } from "./services/data-management-migration.js";
import { registerStructureNodesMigration, cleanupProvisionedStructureAgents } from "./services/structure-nodes-migration.js";
import { registerStructureRegroupMigration } from "./services/structure-regroup-migration.js";
import { registerGroupTabsMigration } from "./services/group-tabs-migration.js";

/**
 * Canonical autonomous task-runner workflow graph (executor-shaped). Stored in
 * ai_workflows.config_json. The agent nodes carry a bounded autoApproveTools
 * allow-list; dangerous trading tools are never on it.
 */
const AUTONOMOUS_TASK_RUNNER_GRAPH = {
  triggerEvents: [],
  nodes: [
    { id: "trigger", type: "trigger", label: "Trigger", config: { input: "" }, position: { x: 0, y: 200 } },
    {
      id: "list_backlog",
      type: "tool",
      label: "List backlog (top priority)",
      config: { tool: "list_project_cards", args: { columnId: "backlog", sort: "priority", limit: 1 } },
      position: { x: 220, y: 200 },
    },
    {
      id: "has_work",
      type: "condition",
      label: "Backlog has work?",
      config: { ref: "list_backlog", op: "non_empty" },
      position: { x: 460, y: 200 },
    },
    { id: "nothing", type: "output", label: "Nothing to do", config: { target: "chat" }, position: { x: 700, y: 320 } },
    {
      id: "to_in_progress",
      type: "agent",
      label: "Move to In Progress",
      config: {
        system: "You move the single top backlog card to the In Progress column.",
        prompt: "Top backlog card JSON: {{list_backlog}}\nMove that card to column in_progress and set status='working'.",
        autoApproveTools: ["update_card", "move_project_card"],
        maxIterations: 3,
      },
      position: { x: 700, y: 120 },
    },
    {
      id: "plan",
      type: "agent",
      label: "Plan subtasks",
      config: {
        system: "You are in PLAN MODE. Decompose the task into atomic subtasks and create each with create_subtask.",
        prompt: "Card: {{list_backlog}}\nBreak it into atomic subtasks and create each one with create_subtask (parentCardId = {{list_backlog.0.id}}).",
        autoApproveTools: ["create_subtask"],
        maxIterations: 8,
      },
      position: { x: 940, y: 120 },
    },
    {
      id: "load_subtasks",
      type: "tool",
      label: "Load subtasks",
      config: { tool: "list_subtasks", args: { parentCardId: "{{list_backlog.0.id}}" } },
      position: { x: 1180, y: 120 },
    },
    {
      id: "subtask_loop",
      type: "loop",
      label: "For each subtask",
      config: { ref: "load_subtasks", maxIterations: 25 },
      position: { x: 1400, y: 120 },
    },
    {
      id: "work_subtask",
      type: "agent",
      label: "Work subtask",
      config: {
        system: "Complete this single subtask, then mark it done.",
        prompt: "Subtask: {{input}}\nDo it, then update_card with status=accepted and columnId=done for that subtask id.",
        autoApproveTools: ["update_card", "set_study_input", "add_card_comment"],
        maxIterations: 12,
      },
      position: { x: 1400, y: 280 },
    },
    {
      id: "to_review",
      type: "agent",
      label: "Move to Review",
      config: {
        system: "Move the parent card to Review and post a summary comment.",
        prompt: "Card: {{list_backlog}}\nMove it to column review (status='awaiting_review') and add a summary comment.",
        autoApproveTools: ["update_card", "move_project_card", "add_card_comment"],
        maxIterations: 4,
      },
      position: { x: 1640, y: 120 },
    },
    {
      id: "review_gate",
      type: "pause",
      label: "Await human review",
      config: { message: "Task ready for review", cardRef: "list_backlog" },
      position: { x: 1880, y: 120 },
    },
    {
      id: "address_comments",
      type: "agent",
      label: "Address comments",
      config: {
        system: "Read the latest user comments on the card and address the requested changes.",
        prompt: "Decision: {{review_gate}}\nRead comments via list_card_comments for card {{list_backlog.0.id}} and address them, then add_card_comment summarizing what changed.",
        autoApproveTools: ["update_card", "add_card_comment", "set_study_input"],
        maxIterations: 12,
      },
      position: { x: 1880, y: 300 },
    },
    {
      id: "to_done",
      type: "agent",
      label: "Move to Done",
      config: {
        system: "Move the approved card to Done.",
        prompt: "Card {{list_backlog}} was approved. Move it to column done with status='accepted'.",
        autoApproveTools: ["update_card", "move_project_card"],
        maxIterations: 3,
      },
      position: { x: 2120, y: 120 },
    },
    { id: "done", type: "output", label: "Done", config: { target: "chat" }, position: { x: 2360, y: 120 } },
  ],
  edges: [
    { from: "trigger", to: "list_backlog" },
    { from: "list_backlog", to: "has_work" },
    { from: "has_work", to: "nothing", label: "false" },
    { from: "has_work", to: "to_in_progress", label: "true" },
    { from: "to_in_progress", to: "plan" },
    { from: "plan", to: "load_subtasks" },
    { from: "load_subtasks", to: "subtask_loop" },
    { from: "subtask_loop", to: "work_subtask", label: "each" },
    { from: "work_subtask", to: "subtask_loop" },
    { from: "subtask_loop", to: "to_review", label: "done" },
    { from: "to_review", to: "review_gate" },
    { from: "review_gate", to: "to_done", label: "approved" },
    { from: "review_gate", to: "address_comments", label: "changes" },
    { from: "address_comments", to: "review_gate" },
    { from: "to_done", to: "done" },
  ],
} as const;

/** Idempotent: rename legacy root agent id intelligence -> intelligence across tenant DB. */
function migrateRootAgentMoneyAiToIntelligence(db: Database.Database): void {
  const legacy = db
    .prepare(`SELECT id FROM ai_agents WHERE id = 'intelligence'`)
    .get() as { id: string } | undefined;
  if (!legacy) return;

  const updates: string[] = [
    `UPDATE ai_memories SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_workflows SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_projects SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_calendar_events SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_agent_rule_state SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_agent_skill_state SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_artifacts SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_reflection_proposals SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_project_cards SET assigned_agent_id = 'intelligence' WHERE assigned_agent_id = 'intelligence'`,
    `UPDATE ai_agent_assignments SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
    `UPDATE ai_agents SET parent_id = 'intelligence' WHERE parent_id = 'intelligence'`,
    `UPDATE platform_action_log SET agent_id = 'intelligence' WHERE agent_id = 'intelligence'`,
  ];
  const tx = db.transaction(() => {
    for (const sql of updates) db.prepare(sql).run();
    db.prepare(
      `UPDATE ai_agents SET id = 'intelligence', name = 'Intelligence' WHERE id = 'intelligence'`
    ).run();
    db.prepare(
      `UPDATE ai_projects SET name = 'Intelligence Projects'
       WHERE id = 'default' AND name = 'Intelligence Projects'`
    ).run();
  });
  tx();
}

export function migrateTenantDb(db: Database.Database): void {
  registerDataManagementMigrations();
  registerStructureNodesMigration();
  registerStructureRegroupMigration();
  registerGroupTabsMigration();
  for (const migration of TENANT_BOOT_MIGRATIONS) {
    registerMigration(migration.version, migration.name, migration.up);
  }

  // Trading schema (playbooks / market data / backtests) is owned by the sierra plugin.
  db.exec(`
    /* ----------------------------- App structure --------------------------- */
    CREATE TABLE IF NOT EXISTS departments (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      icon        TEXT NOT NULL,
      base_path   TEXT NOT NULL UNIQUE,
      built_in    INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS divisions (
      id              TEXT NOT NULL,
      department_id   TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      label           TEXT NOT NULL,
      icon            TEXT NOT NULL,
      base_path       TEXT NOT NULL UNIQUE,
      right_sidebar   TEXT,
      built_in        INTEGER NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (department_id, id)
    );

    CREATE TABLE IF NOT EXISTS division_pages (
      id              TEXT NOT NULL,
      division_id     TEXT NOT NULL,
      department_id   TEXT NOT NULL,
      label           TEXT NOT NULL,
      icon            TEXT NOT NULL,
      segment         TEXT NOT NULL DEFAULT '',
      page_kind       TEXT NOT NULL,
      built_in        INTEGER NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (department_id, division_id, id),
      FOREIGN KEY (department_id, division_id)
        REFERENCES divisions(department_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS division_pages_by_division
      ON division_pages(department_id, division_id, sort_order);

    CREATE TABLE IF NOT EXISTS structure_nodes (
      id            TEXT PRIMARY KEY,
      parent_id     TEXT REFERENCES structure_nodes(id) ON DELETE CASCADE,
      label         TEXT NOT NULL,
      icon          TEXT NOT NULL,
      segment       TEXT NOT NULL DEFAULT '',
      kind          TEXT NOT NULL DEFAULT 'placeholder',
      object_type   TEXT,
      right_sidebar TEXT,
      agent_id      TEXT,
      built_in      INTEGER NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS structure_nodes_by_parent
      ON structure_nodes(parent_id, sort_order);
  `);

  runPendingMigrations(db);
  ensureCapabilityTables(db);
  cleanupProvisionedStructureAgents(db);

  const fkViolationsMid = runForeignKeyCheck(db);
  if (fkViolationsMid.length > 0) {
    console.warn(`[db] foreign_key_check: ${fkViolationsMid.length} violation(s) — keeping foreign_keys OFF`);
    for (const v of fkViolationsMid.slice(0, 5)) console.warn(`  ${v}`);
  }
}

export type AppDatabase = Database.Database;

export const TENANT_BOOT_MIGRATIONS = [
  { version: 7, name: "structure_object_type_v1", up: migrateStructureObjectType },
  { version: 8, name: "trade_mirror_columns_v1", up: migrateTradeMirrorSchema },
  { version: 9, name: "unified_data_schema_v1", up: migrateUnifiedDataSchema },
  { version: 10, name: "backtest_native_schema_v1", up: migrateBacktestNativeSchema },
  { version: 11, name: "playbook_graph_schema_v1", up: migratePlaybookGraphSchema },
  { version: 12, name: "archive_lessons_schema_v1", up: migrateArchiveLessonsSchema },
  { version: 13, name: "holdings_schema_v1", up: createHoldingsSchema },
  { version: 14, name: "multi_board_tasks_github_v1", up: migrateMultiBoardTasksSchema },
] as const;

/** Personal multi-board Tasks + optional GitHub Project sync columns on ai_projects. */
function migrateMultiBoardTasksSchema(db: Database.Database): void {
  addColumn(db, "ai_projects", "archived_at", "TEXT");
  addColumn(db, "ai_projects", "github_project_node_id", "TEXT");
  addColumn(db, "ai_projects", "github_project_url", "TEXT");
  addColumn(db, "ai_projects", "github_status_map_json", "TEXT");
  addColumn(db, "ai_projects", "sync_enabled", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "ai_projects", "last_synced_at", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS ai_projects_user_idx ON ai_projects(user_id);
  `);
}

function migrateStructureObjectType(db: Database.Database): void {
  addColumn(db, "structure_nodes", "object_type", "TEXT");
}

function createHoldingsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS holdings_connections (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      external_id TEXT,
      balance REAL NOT NULL DEFAULT 0,
      balance_cad REAL NOT NULL DEFAULT 0,
      breakdown_json TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS holdings_connections_category
      ON holdings_connections(category);

    CREATE TABLE IF NOT EXISTS holdings_balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      balance REAL NOT NULL,
      currency TEXT NOT NULL,
      balance_cad REAL NOT NULL,
      raw_json TEXT,
      as_of TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (connection_id) REFERENCES holdings_connections(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS holdings_snapshots_connection
      ON holdings_balance_snapshots(connection_id, as_of DESC);

    CREATE TABLE IF NOT EXISTS holdings_credentials (
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      value_encrypted TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider, name)
    );
  `);
}

function migrateArchiveLessonsSchema(_db: Database.Database): void {
  // Owned by the sierra plugin (ensureSierraSchema). Version kept for bookkeeping.
}

function migratePlaybookGraphSchema(db: Database.Database): void {
  if (!tableExists(db, "playbooks")) return;
  addColumn(db, "playbooks", "graph_json", "TEXT");
}

function migrateBacktestNativeSchema(db: Database.Database): void {
  // Owned by the sierra plugin. Version kept for bookkeeping on existing tenants.
  if (!tableExists(db, "backtest_runs")) return;
}

function migrateTradeMirrorSchema(db: Database.Database): void {
  // Owned by the sierra plugin. Version kept for bookkeeping on existing tenants.
  if (!tableExists(db, "sc_trades")) return;
}

function migrateUnifiedDataSchema(db: Database.Database): void {
  // Trading tables are owned by the sierra plugin.
  // This migration only creates core Intelligence schema.
  const addCol = (table: string, col: string, def: string) => {
    if (!tableExists(db, table)) return;
    addColumn(db, table, col, def);
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (chat_id) REFERENCES ai_chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS ai_messages_chat_idx ON ai_messages(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS ai_memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      chat_id TEXT,
      text TEXT NOT NULL,
      category TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_memories_scope ON ai_memories(scope, enabled);

    CREATE TABLE IF NOT EXISTS ai_prompt_flow (
      id TEXT PRIMARY KEY DEFAULT 'default',
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_rule_state (
      rule_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority_override INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_skill_state (
      skill_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_adapters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      domain TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      default_scale REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      path TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_training_jobs (
      id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      config_json TEXT NOT NULL,
      log TEXT NOT NULL DEFAULT '',
      progress REAL NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_schedules (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/Denver',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_prompt_queue (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0,
      workflow_id TEXT,
      adapter_ids_json TEXT,
      prompt TEXT,
      context_json TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ai_prompt_queue_status ON ai_prompt_queue(status, priority DESC, created_at ASC);

    CREATE TABLE IF NOT EXISTS ai_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_project_columns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES ai_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_project_cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      linked_chat_id TEXT,
      linked_workflow_id TEXT,
      tags_json TEXT,
      due_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES ai_projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_card_comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_card_comments_card_idx ON ai_card_comments(card_id, created_at);

    CREATE TABLE IF NOT EXISTS ai_workflow_comments (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_workflow_comments_wf_idx ON ai_workflow_comments(workflow_id, created_at);

    CREATE TABLE IF NOT EXISTS ai_workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      trigger_input TEXT,
      state_json TEXT NOT NULL DEFAULT '{}',
      awaiting_node_id TEXT,
      card_id TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_workflow_runs_status ON ai_workflow_runs(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ai_calendar_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'intelligence',
      kind TEXT NOT NULL DEFAULT 'event',
      title TEXT NOT NULL,
      description TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      linked_card_id TEXT,
      linked_run_id TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_calendar_events_agent_idx ON ai_calendar_events(agent_id, start_at);
  `);

  // Per-agent sandbox isolation: memory, rules/skills enable state, and
  // artifact metadata are scoped to a single agent. Content for rules/skills
  // still lives in the shared repo data dir; only the enable/disable state is
  // per-agent. Existing global rows are backfilled to the root 'intelligence'.
  // Multi-tenant background workers: queue rows carry the tenant whose DB the
  // job runs against. Legacy rows (NULL) are treated as the operator tenant by
  // the worker. Per-user scoping: chats/messages record their authoring user.
  addCol("ai_prompt_queue", "tenant_id", "TEXT");
  addCol("ai_chats", "user_id", "TEXT");
  addCol("ai_messages", "user_id", "TEXT");
  addCol("ai_chats", "distilled_at", "TEXT");
  addCol("ai_chats", "distill_msg_count", "INTEGER");

  addCol("ai_memories", "agent_id", "TEXT");
  // Memory engine: 'active' memories are injected into prompts; 'pending' ones
  // await user approval (approval mode). Existing rows default to 'active'.
  addCol("ai_memories", "status", "TEXT NOT NULL DEFAULT 'active'");
  // Semantic RAG: L2-normalized embedding stored as a little-endian f32 BLOB so
  // semantic (cosine) retrieval can run in-process. NULL until backfilled by
  // the embedder; retrieval falls back to recency when absent.
  addCol("ai_memories", "embedding", "BLOB");
  addCol("ai_memories", "embedding_dim", "INTEGER");
  addCol("ai_memories", "pack_id", "TEXT");
  addCol("ai_prompt_flow", "name", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_knowledge_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_knowledge_packs_name_idx ON ai_knowledge_packs(name);
  `);
  db.prepare(`UPDATE ai_memories SET agent_id = 'intelligence' WHERE agent_id IS NULL`).run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_agent_rule_state (
      agent_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority_override INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, rule_id)
    );

    CREATE TABLE IF NOT EXISTS ai_agent_skill_state (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS ai_rule_provisioning (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      origin TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (scope_type, scope_id, rule_id)
    );

    CREATE TABLE IF NOT EXISTS ai_context_profiles (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (scope_type, scope_id)
    );

    CREATE TABLE IF NOT EXISTS ai_artifacts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'file',
      mime_type TEXT,
      path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      source TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_artifacts_agent_idx ON ai_artifacts(agent_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ai_reflection_proposals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_id TEXT,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_reflection_proposals_agent_idx
      ON ai_reflection_proposals(agent_id, status, created_at DESC);
  `);

  // Self-authoring: skills/rules drafted by reflection land in 'pending' and
  // are excluded from prompt assembly until approved (mirrors ai_memories.status).
  // Existing per-agent state rows default to 'active'.
  addCol("ai_agent_skill_state", "status", "TEXT NOT NULL DEFAULT 'active'");
  addCol("ai_agent_rule_state", "status", "TEXT NOT NULL DEFAULT 'active'");

  // Copy legacy global rule/skill enable state into the root agent's per-agent
  // tables on first run so Intelligence keeps its current toggles. Never overwrites
  // existing per-agent rows.
  db.prepare(
    `INSERT OR IGNORE INTO ai_agent_rule_state (agent_id, rule_id, enabled, priority_override, updated_at)
       SELECT 'intelligence', rule_id, enabled, priority_override, updated_at FROM ai_rule_state`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO ai_agent_skill_state (agent_id, skill_id, enabled, last_used_at, updated_at)
       SELECT 'intelligence', skill_id, enabled, last_used_at, updated_at FROM ai_skill_state`
  ).run();

  // Seed default project + columns if empty
  const proj = db.prepare(`SELECT id FROM ai_projects LIMIT 1`).get();
  if (!proj) {
      db.prepare(`INSERT INTO ai_projects (id, name) VALUES ('default', 'Intelligence Projects')`).run();
      const cols = [
        ["backlog", "Backlog", 0],
        ["in_progress", "In Progress", 1],
        ["review", "Review", 2],
        ["done", "Done", 3],
      ] as const;
      for (const [id, name, order] of cols) {
        db.prepare(
          `INSERT INTO ai_project_columns (id, project_id, name, sort_order) VALUES (?, 'default', ?, ?)`
        ).run(id, name, order);
      }
  }

  // Seed the canonical autonomous task-runner workflow (idempotent). It is the
  // 12-step loop: check backlog → priority → in progress → plan subtasks → work
  // subtasks → review → comments → address → accept → done. Left enabled so the
  // user can run it from the queue / attach a cron schedule; no schedule is
  // auto-created to avoid surprising autonomous activity.
  const existing = db
      .prepare(`SELECT id FROM ai_workflows WHERE id = 'autonomous-task-runner'`)
      .get();
  if (!existing) {
      db.prepare(
        `INSERT INTO ai_workflows (id, name, config_json, enabled)
         VALUES ('autonomous-task-runner', 'Autonomous Task Runner', ?, 1)`
      ).run(JSON.stringify(AUTONOMOUS_TASK_RUNNER_GRAPH));
  }

  addCol("ai_project_cards", "prompt", "TEXT");
  addCol("ai_project_cards", "context_json", "TEXT");
  addCol("ai_project_cards", "priority", "INTEGER NOT NULL DEFAULT 2");
  addCol("ai_project_cards", "parent_card_id", "TEXT");
  addCol("ai_project_cards", "status", "TEXT");
  addCol("ai_project_cards", "assigned_agent_id", "TEXT");

  // Audit-log categorization for card comments (e.g. 'note' | 'action' |
  // 'result' | 'issue'). Existing rows default to NULL → treated as 'note'.
  addCol("ai_card_comments", "kind", "TEXT");

  // Optional run timing columns surfaced on the per-agent calendar timeline.
  addCol("ai_workflow_runs", "started_at", "TEXT");
  addCol("ai_workflow_runs", "finished_at", "TEXT");

  // Per-agent ownership: workflows and projects belong to a single agent.
  // Existing global rows are backfilled to the root 'intelligence' agent so the
  // current board / workflows continue to appear under Intelligence.
  addCol("ai_workflows", "agent_id", "TEXT");
  addCol("ai_projects", "agent_id", "TEXT");
  // Per-user personal calendar/tasks (scoped by user_id in owner workspace tenant DB).
  addCol("ai_calendar_events", "user_id", "TEXT");
  addCol("ai_projects", "user_id", "TEXT");
  addCol("ai_projects", "archived_at", "TEXT");
  addCol("ai_projects", "github_project_node_id", "TEXT");
  addCol("ai_projects", "github_project_url", "TEXT");
  addCol("ai_projects", "github_status_map_json", "TEXT");
  addCol("ai_projects", "sync_enabled", "INTEGER NOT NULL DEFAULT 0");
  addCol("ai_projects", "last_synced_at", "TEXT");
  db.exec(`
      CREATE INDEX IF NOT EXISTS ai_calendar_events_user_idx
        ON ai_calendar_events(user_id, start_at);
      CREATE INDEX IF NOT EXISTS ai_projects_user_idx
        ON ai_projects(user_id);
    `);
  db.prepare(`UPDATE ai_workflows SET agent_id = 'intelligence' WHERE agent_id IS NULL`).run();
  db.prepare(`UPDATE ai_projects SET agent_id = 'intelligence' WHERE agent_id IS NULL AND user_id IS NULL`).run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      backend TEXT NOT NULL DEFAULT 'local',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_template INTEGER NOT NULL DEFAULT 0,
      system_prompt TEXT NOT NULL,
      sampling_json TEXT NOT NULL DEFAULT '{}',
      thinking_json TEXT NOT NULL DEFAULT '{}',
      tool_allow_json TEXT,
      auto_approve_json TEXT NOT NULL DEFAULT '[]',
      model_path TEXT,
      adapter_ids_json TEXT NOT NULL DEFAULT '[]',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_agent_accounts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT,
      provider_user_id TEXT,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      scopes_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ai_agent_accounts_agent
      ON ai_agent_accounts(agent_id, status);

    CREATE TABLE IF NOT EXISTS ai_agent_assignments (
      scope_type TEXT NOT NULL,
      scope_id   TEXT NOT NULL,
      agent_id   TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (scope_type, scope_id)
    );

    CREATE TABLE IF NOT EXISTS platform_action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      scope TEXT,
      payload_hash TEXT,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS platform_action_log_by_ts
      ON platform_action_log(created_at DESC);

    CREATE TABLE IF NOT EXISTS kernel_action_idempotency (
      key TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action_name TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (key, actor_id, object_type, record_id, action_name)
    );

    -- Tenant-owned half of cross-database marketplace clone acquisitions.
    -- The import receipt, audit row, and outbox event commit with the import.
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_imports (
      operation_id TEXT PRIMARY KEY,
      buyer_tenant_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      imported_kind TEXT NOT NULL,
      imported_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_audit (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      owner_database TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS marketplace_acquisition_outbox (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kernel_operation_runs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      actor_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      record_id TEXT,
      action_name TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL,
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS kernel_operation_runs_status
      ON kernel_operation_runs(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS bank_ledger_entries (
      id TEXT PRIMARY KEY,
      category TEXT,
      label TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      source TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS bank_ledger_by_recorded
      ON bank_ledger_entries(recorded_at DESC);
  `);

  // Platform Builder role on each assignment: viewer | editor | owner. Existing
  // rows predate roles and default to 'owner' (the historical de-facto behavior
  // where an assigned agent fully owned its scope).
  addCol("ai_agent_assignments", "role", "TEXT NOT NULL DEFAULT 'owner'");

  // Org-chart hierarchy: an agent can report to a parent agent and belong to a
  // named team. Existing rows leave both NULL (everything reports to intelligence).
  addCol("ai_agents", "parent_id", "TEXT");
  addCol("ai_agents", "team", "TEXT");

  migrateRootAgentMoneyAiToIntelligence(db);
  seedIntelligenceAgent(db);
  removeDeprecatedBuiltinAgents(db);
  ensureAgentPrincipalDefaults(db);
  ensureIntelligenceDescription(db);
  ensureIntelligenceCodeAccess(db);
  ensureIntelligenceLocalBackendWhenExternalLlm(db);
  ensureSpecialistCodeAccess(db);
  ensureAgentReflectionDefaults(db);
  ensureAgentAutoApproveDefaults(db);
  ensureAgentDescriptions(db);
  ensureAutonomousTaskRunnerSchedule(db);
  ensureLlmAutoStartIfModelSet(db);

  addCol("ai_artifacts", "content", "TEXT");
  addCol("ai_memories", "embedding_model", "TEXT");
  addCol("ai_memories", "valid_from", "TEXT");
  addCol("ai_memories", "valid_until", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS ai_project_cards_by_project
      ON ai_project_cards(project_id, sort_order);
    CREATE INDEX IF NOT EXISTS ai_project_cards_by_column
      ON ai_project_cards(column_id, sort_order);
    CREATE INDEX IF NOT EXISTS ai_project_cards_by_parent
      ON ai_project_cards(parent_card_id, sort_order);
    CREATE INDEX IF NOT EXISTS ai_project_cards_by_agent_due
      ON ai_project_cards(assigned_agent_id, due_at);
  `);

  // Legacy trading column backfills — only when sierra plugin tables already exist.
  if (tableExists(db, "sc_positions")) {
    addCol("sc_positions", "position_key", "TEXT");
    addCol("sc_positions", "source_dtc", "INTEGER NOT NULL DEFAULT 0");
    addCol("sc_positions", "source_acsil", "INTEGER NOT NULL DEFAULT 0");
    db.prepare(
      `UPDATE sc_positions SET position_key = playbook_id WHERE position_key IS NULL`
    ).run();
    db.prepare(`UPDATE sc_positions SET source_acsil = 1`).run();
  }
  if (tableExists(db, "sc_fills")) {
    db.prepare(`UPDATE sc_fills SET source_acsil = 1 WHERE source = 'acsil'`).run();
  }
  if (tableExists(db, "sc_trades")) {
    db.prepare(`UPDATE sc_trades SET source_acsil = 1 WHERE source = 'acsil'`).run();
  }

  const fkViolations = runForeignKeyCheck(db);
  if (fkViolations.length > 0) {
    console.warn(`[db] foreign_key_check: ${fkViolations.length} violation(s) — keeping foreign_keys OFF`);
    for (const v of fkViolations.slice(0, 5)) console.warn(`  ${v}`);
  }
}

function ensureAutonomousTaskRunnerSchedule(db: AppDatabase): void {
  const wf = db
    .prepare(`SELECT id FROM ai_workflows WHERE id = 'autonomous-task-runner'`)
    .get();
  if (!wf) return;
  const existing = db
    .prepare(`SELECT id FROM ai_schedules WHERE workflow_id = 'autonomous-task-runner' LIMIT 1`)
    .get();
  if (existing) return;
  db.prepare(
    `INSERT INTO ai_schedules (id, workflow_id, cron_expr, timezone, enabled)
     VALUES (?, 'autonomous-task-runner', '*/30 * * * *', 'America/Denver', 1)`
  ).run(uuidv4());
}

function ensureLlmAutoStartIfModelSet(db: AppDatabase): void {
  const model = db
    .prepare(`SELECT value FROM ai_settings WHERE key = 'activeModelPath'`)
    .get() as { value: string } | undefined;
  if (!model?.value?.trim()) return;
  const auto = db
    .prepare(`SELECT value FROM ai_settings WHERE key = 'autoStart'`)
    .get() as { value: string } | undefined;
  if (auto?.value === "true") return;
  db.prepare(
    `INSERT INTO ai_settings (key, value, updated_at) VALUES ('autoStart', 'true', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = datetime('now')`
  ).run();
}

/** Legacy single-file open (used for migration seed from platform.db). */
export function initDb(): Database.Database {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(config.dbPath);
  configureDbPragmas(db);
  logDbConfig(db);
  migrateTenantDb(db);
  return db;
}
