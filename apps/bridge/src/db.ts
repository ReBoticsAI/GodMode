import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { seedIntelligenceAgent, removeDeprecatedBuiltinAgents, ensureAgentPrincipalDefaults, ensureIntelligenceDescription, ensureIntelligenceCodeAccess, ensureIntelligenceLocalBackendWhenExternalLlm, ensureAgentDescriptions, ensureAgentReflectionDefaults, ensureAgentAutoApproveDefaults, ensureSpecialistCodeAccess } from "./services/agents/agents-db.js";
import { createSchedule } from "./services/ai-scheduler.js";
import { configureDbPragmas, logDbConfig, runForeignKeyCheck } from "./services/db-config.js";
import { runPendingMigrations } from "./services/db-migrations.js";
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS playbooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      spec_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      status TEXT NOT NULL,
      step TEXT,
      message TEXT,
      chart_number INTEGER,
      study_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (playbook_id) REFERENCES playbooks(id)
    );

    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      playbook_id TEXT,
      symbol TEXT,
      side TEXT,
      qty REAL,
      price REAL,
      pnl REAL,
      order_id TEXT,
      fill_time TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS positions (
      symbol TEXT PRIMARY KEY,
      qty REAL NOT NULL DEFAULT 0,
      avg_price REAL,
      unrealized_pnl REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      side TEXT,
      qty REAL,
      price REAL,
      status TEXT,
      playbook_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS master_studies (
      chart_number INTEGER NOT NULL,
      study_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chart_number, study_id)
    );

    CREATE TABLE IF NOT EXISTS master_subgraphs (
      chart_number INTEGER NOT NULL,
      study_id INTEGER NOT NULL,
      subgraph_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chart_number, study_id, subgraph_index)
    );

    /* ----------------------------- Trading plan ----------------------------- */
    CREATE TABLE IF NOT EXISTS trading_plan (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      spec_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS routine_completions (
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (day, kind, item_id)
    );

    CREATE TABLE IF NOT EXISTS daily_state (
      day TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'live',
      pnl_usd REAL NOT NULL DEFAULT 0,
      trades_count INTEGER NOT NULL DEFAULT 0,
      losses_count INTEGER NOT NULL DEFAULT 0,
      consecutive_losses INTEGER NOT NULL DEFAULT 0,
      max_loss_hit INTEGER NOT NULL DEFAULT 0,
      premarket_complete INTEGER NOT NULL DEFAULT 0,
      random_trade_flag INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hard_rule_violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ----------------------------- Journal extras --------------------------- */
    CREATE TABLE IF NOT EXISTS journal_extra (
      entry_id TEXT PRIMARY KEY,
      rating_stars INTEGER,
      score INTEGER,
      tags_json TEXT,
      screenshot_path TEXT,
      veto_results_json TEXT,
      review_answers_json TEXT,
      random_trade INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---------------------- External trade mirror --------------------- */
    CREATE TABLE IF NOT EXISTS sc_trades (
      trade_key TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      chart_number INTEGER NOT NULL,
      symbol TEXT,
      account TEXT,
      open_time TEXT NOT NULL,
      close_time TEXT,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      entry_price REAL,
      exit_price REAL,
      pnl_usd REAL,
      mae_usd REAL,
      mfe_usd REAL,
      source TEXT NOT NULL DEFAULT 'acsil',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sc_trades_by_pb_close
      ON sc_trades(playbook_id, close_time);

    CREATE TABLE IF NOT EXISTS sc_trade_stats (
      playbook_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      symbol TEXT,
      account TEXT,
      chart_number INTEGER,
      total_trades INTEGER,
      wins INTEGER,
      losses INTEGER,
      net_pnl_usd REAL,
      win_rate REAL,
      avg_win_usd REAL,
      avg_loss_usd REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (playbook_id, scope)
    );

    CREATE TABLE IF NOT EXISTS sc_trade_heartbeats (
      playbook_id TEXT PRIMARY KEY,
      chart_number INTEGER,
      size INTEGER,
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sc_positions (
      playbook_id TEXT PRIMARY KEY,
      chart_number INTEGER,
      symbol TEXT,
      account TEXT,
      pos_qty REAL NOT NULL DEFAULT 0,
      avg_price REAL,
      open_pnl_usd REAL NOT NULL DEFAULT 0,
      daily_pnl_usd REAL NOT NULL DEFAULT 0,
      cum_pnl_usd REAL,
      mae_open_usd REAL,
      mfe_open_usd REAL,
      working_orders INTEGER NOT NULL DEFAULT 0,
      total_fills_day INTEGER,
      last_fill_time TEXT,
      last_trade_pnl REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sc_fills (
      fill_key TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      chart_number INTEGER NOT NULL,
      fill_idx INTEGER NOT NULL,
      symbol TEXT,
      account TEXT,
      ts TEXT NOT NULL,
      side TEXT,
      open_close TEXT,
      order_type TEXT,
      qty REAL,
      fill_price REAL,
      internal_order_id INTEGER,
      service_order_id TEXT,
      is_automated INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'acsil',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sc_fills_by_ts ON sc_fills(ts);
    CREATE INDEX IF NOT EXISTS sc_fills_by_pb ON sc_fills(playbook_id, ts);

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

  try {
    db.exec(`ALTER TABLE structure_nodes ADD COLUMN object_type TEXT`);
  } catch {
    /* already migrated */
  }

  migrateTradeMirrorSchema(db);
  migrateUnifiedDataSchema(db);
  migrateScLevelsKey(db);
  migrateScLevelsStyle(db);
  migrateBacktestNativeSchema(db);
  migratePlaybookGraphSchema(db);
  migrateArchiveLessonsSchema(db);
  createHoldingsSchema(db);

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

function migrateArchiveLessonsSchema(db: Database.Database): void {
  const addCol = (table: string, col: string, def: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch {
      /* exists */
    }
  };

  addCol("playbook_signal_state", "metadata_json", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playbook_id TEXT NOT NULL,
      chart_number INTEGER,
      phase TEXT NOT NULL,
      detail TEXT,
      snapshot_json TEXT,
      sc_ts TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS setup_phases_by_playbook
      ON setup_phases(playbook_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS order_lifecycle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playbook_id TEXT NOT NULL,
      chart_number INTEGER,
      event TEXT NOT NULL,
      internal_order_id INTEGER,
      side TEXT,
      qty REAL,
      price REAL,
      status TEXT,
      sc_ts TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS order_lifecycle_by_playbook
      ON order_lifecycle(playbook_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS study_settings (
      playbook_id TEXT NOT NULL,
      input_idx INTEGER NOT NULL,
      input_name TEXT,
      value REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (playbook_id, input_idx)
    );

    CREATE TABLE IF NOT EXISTS study_settings_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playbook_id TEXT NOT NULL,
      input_idx INTEGER NOT NULL,
      input_name TEXT,
      prev_value REAL,
      new_value REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'web',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS study_settings_log_by_pb
      ON study_settings_log(playbook_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS playbook_zones (
      playbook_id TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      valid INTEGER NOT NULL DEFAULT 0,
      families INTEGER NOT NULL DEFAULT 0,
      lo REAL,
      hi REAL,
      sc_ts TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (playbook_id, signal_id)
    );
    CREATE INDEX IF NOT EXISTS playbook_zones_by_pb
      ON playbook_zones(playbook_id, updated_at DESC);
  `);
}

function migratePlaybookGraphSchema(db: Database.Database): void {
  try {
    db.exec(`ALTER TABLE playbooks ADD COLUMN graph_json TEXT`);
  } catch {
    /* exists */
  }
}

function migrateBacktestNativeSchema(db: Database.Database): void {
  const addCol = (table: string, col: string, def: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch {
      /* exists */
    }
  };

  addCol("backtest_runs", "trade_account", "TEXT");
  addCol("backtest_runs", "replay_mode", "TEXT");
  addCol("backtest_runs", "charts_to_replay", "TEXT");
  addCol("backtest_runs", "replay_speed", "REAL");
  addCol("backtest_runs", "days_to_load", "INTEGER");
  addCol("backtest_runs", "processing_step_seconds", "INTEGER");
  addCol("backtest_runs", "sim_only", "INTEGER NOT NULL DEFAULT 1");

  db.exec(`
    CREATE TABLE IF NOT EXISTS backtest_trades (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
      trade_index INTEGER NOT NULL,
      symbol TEXT,
      trade_account TEXT,
      entry_price REAL,
      exit_price REAL,
      quantity REAL,
      side INTEGER,
      pnl REAL,
      max_adverse REAL,
      max_favorable REAL,
      entry_ts TEXT,
      exit_ts TEXT,
      internal_order_id INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bt_trades_run ON backtest_trades(run_id, trade_index);
  `);
}

function migrateScLevelsKey(db: Database.Database): void {
  // Rebuild sc_levels if it still uses the legacy (symbol,label) PK.
  // Each external source (chart, study, subgraph) now owns its own row.
  try {
    const cols = db
      .prepare("PRAGMA table_info(sc_levels)")
      .all() as Array<{ name: string }>;
    const hasSourceKey = cols.some((c) => c.name === "source_key");
    if (hasSourceKey) return;
    db.exec(`
      DROP TABLE IF EXISTS sc_levels;
      CREATE TABLE sc_levels (
        symbol TEXT NOT NULL,
        source_key TEXT NOT NULL,
        label TEXT NOT NULL,
        price REAL NOT NULL,
        kind TEXT,
        chart_number INTEGER,
        study_id INTEGER,
        subgraph_index INTEGER,
        color TEXT,
        line_width INTEGER,
        ts TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (symbol, source_key)
      );
      CREATE INDEX IF NOT EXISTS sc_levels_by_symbol ON sc_levels(symbol, price DESC);
    `);
  } catch (err) {
    console.warn("[migrate] sc_levels rebuild failed", err);
  }
}

function migrateScLevelsStyle(db: Database.Database): void {
  const addCol = (col: string, def: string) => {
    try {
      db.exec(`ALTER TABLE sc_levels ADD COLUMN ${col} ${def}`);
    } catch {
      /* column exists */
    }
  };
  addCol("color", "TEXT");
  addCol("line_width", "INTEGER");
}

function migrateTradeMirrorSchema(db: Database.Database): void {
  const addCol = (table: string, col: string, def: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch {
      /* column exists */
    }
  };

  addCol("sc_trades", "commission_usd", "REAL");
  addCol("sc_trades", "eff_entry", "REAL");
  addCol("sc_trades", "eff_exit", "REAL");
  addCol("sc_trades", "eff_total", "REAL");
  addCol("sc_trades", "runup_usd", "REAL");
  addCol("sc_trades", "drawdown_usd", "REAL");
  addCol("sc_trades", "trade_name", "TEXT");
  addCol("sc_trades", "note", "TEXT");

  addCol("sc_trade_stats", "total_profit_usd", "REAL");
  addCol("sc_trade_stats", "total_loss_usd", "REAL");
  addCol("sc_trade_stats", "profit_factor", "REAL");
  addCol("sc_trade_stats", "max_runup_usd", "REAL");
  addCol("sc_trade_stats", "max_drawdown_usd", "REAL");
  addCol("sc_trade_stats", "total_commissions_usd", "REAL");
  addCol("sc_trade_stats", "max_consec_winners", "INTEGER");
  addCol("sc_trade_stats", "max_consec_losers", "INTEGER");
  addCol("sc_trade_stats", "avg_time_in_trade_sec", "INTEGER");
  addCol("sc_trade_stats", "expectancy", "REAL");
  addCol("sc_trade_stats", "total_quantity", "INTEGER");
  addCol("sc_trade_stats", "largest_winner_usd", "REAL");
  addCol("sc_trade_stats", "largest_loser_usd", "REAL");
  addCol("sc_trade_stats", "total_flat_to_flat_trades", "INTEGER");
  addCol("sc_trade_stats", "flat_to_flat_pct_profitable", "REAL");

  addCol("sc_positions", "total_fills_day", "INTEGER");
  addCol("sc_positions", "last_fill_time", "TEXT");
  addCol("sc_positions", "last_trade_pnl", "REAL");
}

function migrateUnifiedDataSchema(db: Database.Database): void {
  const addCol = (table: string, col: string, def: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch {
      /* exists */
    }
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS sc_orders (
      internal_order_id TEXT PRIMARY KEY,
      service_order_id TEXT,
      playbook_id TEXT,
      chart_number INTEGER,
      account TEXT,
      symbol TEXT,
      side TEXT,
      qty REAL,
      price REAL,
      stop_price REAL,
      target_price REAL,
      order_type TEXT,
      tif TEXT,
      status TEXT,
      parent_order_id TEXT,
      text_tag TEXT,
      is_automated INTEGER NOT NULL DEFAULT 0,
      source_dtc INTEGER NOT NULL DEFAULT 0,
      source_acsil INTEGER NOT NULL DEFAULT 0,
      source_file INTEGER NOT NULL DEFAULT 0,
      dtc_updated_at TEXT,
      acsil_updated_at TEXT,
      file_updated_at TEXT,
      last_writer TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sc_orders_by_symbol ON sc_orders(symbol, updated_at);

    CREATE TABLE IF NOT EXISTS sc_account (
      account TEXT PRIMARY KEY,
      cash_balance REAL,
      securities_value REAL,
      margin_requirement REAL,
      buying_power REAL,
      equity REAL,
      open_pnl REAL,
      day_pnl REAL,
      currency TEXT,
      trade_service_connected INTEGER NOT NULL DEFAULT 0,
      is_simulated INTEGER NOT NULL DEFAULT 0,
      evaluator_high_water_mark REAL,
      evaluator_day_open_balance REAL,
      source_dtc INTEGER NOT NULL DEFAULT 0,
      source_acsil INTEGER NOT NULL DEFAULT 0,
      dtc_updated_at TEXT,
      acsil_updated_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sc_security (
      symbol TEXT PRIMARY KEY,
      tick_size REAL,
      currency_value_per_tick REAL,
      multiplier REAL,
      min_qty REAL,
      currency TEXT,
      exchange TEXT,
      description TEXT,
      source_dtc INTEGER NOT NULL DEFAULT 0,
      source_acsil INTEGER NOT NULL DEFAULT 0,
      dtc_updated_at TEXT,
      acsil_updated_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sc_market (
      symbol TEXT PRIMARY KEY,
      bid REAL,
      ask REAL,
      last REAL,
      spread REAL,
      bid_size REAL,
      ask_size REAL,
      volume_today REAL,
      ts TEXT,
      source TEXT NOT NULL DEFAULT 'file',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sc_bars (
      bar_key TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      ts TEXT NOT NULL,
      interval_sec INTEGER NOT NULL DEFAULT 0,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      num_trades INTEGER,
      total_volume INTEGER,
      bid_volume INTEGER,
      ask_volume INTEGER,
      source_file_offset INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sc_bars_by_symbol_ts ON sc_bars(symbol, ts);

    CREATE TABLE IF NOT EXISTS sc_depth_history (
      depth_key TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      ts TEXT NOT NULL,
      level INTEGER NOT NULL,
      side TEXT NOT NULL,
      price REAL,
      qty REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS sc_depth_by_symbol_ts ON sc_depth_history(symbol, ts);

    CREATE TABLE IF NOT EXISTS chartbook_layout (
      chartbook_path TEXT NOT NULL,
      chart_number INTEGER NOT NULL,
      symbol TEXT,
      timeframe TEXT,
      study_list_json TEXT,
      parsed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chartbook_path, chart_number)
    );

    CREATE TABLE IF NOT EXISTS file_cursors (
      file_path TEXT PRIMARY KEY,
      last_offset INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS data_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field TEXT NOT NULL,
      dtc_value TEXT,
      acsil_value TEXT,
      file_value TEXT,
      delta REAL,
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS data_audit_by_ts ON data_audit(ts DESC);

    CREATE TABLE IF NOT EXISTS account_config (
      account TEXT PRIMARY KEY,
      broker TEXT,
      account_type TEXT NOT NULL DEFAULT 'sim',
      account_size REAL,
      daily_loss_limit REAL,
      max_drawdown REAL,
      drawdown_style TEXT,
      profit_target REAL,
      allow_overnight INTEGER NOT NULL DEFAULT 0,
      allow_news INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS source_health (
      source TEXT PRIMARY KEY,
      last_write_at TEXT,
      ok INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sc_levels (
      symbol TEXT NOT NULL,
      source_key TEXT NOT NULL,
      label TEXT NOT NULL,
      price REAL NOT NULL,
      kind TEXT,
      chart_number INTEGER,
      study_id INTEGER,
      subgraph_index INTEGER,
      color TEXT,
      line_width INTEGER,
      ts TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, source_key)
    );
    CREATE INDEX IF NOT EXISTS sc_levels_by_symbol ON sc_levels(symbol, price DESC);

    CREATE TABLE IF NOT EXISTS sc_timesales (
      symbol TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts REAL,
      price REAL,
      size REAL,
      side TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, seq)
    );
    CREATE INDEX IF NOT EXISTS sc_timesales_by_symbol_ts ON sc_timesales(symbol, seq DESC);

    CREATE TABLE IF NOT EXISTS sc_dom (
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      size REAL NOT NULL,
      snap_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, side, price)
    );
    CREATE INDEX IF NOT EXISTS sc_dom_by_symbol ON sc_dom(symbol, price DESC);

    CREATE TABLE IF NOT EXISTS sc_signal (
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      value REAL,
      chart_number INTEGER,
      study_id INTEGER,
      subgraph_index INTEGER,
      ts TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, kind)
    );

    CREATE TABLE IF NOT EXISTS playbook_signal_state (
      playbook_id TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      value INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'signal',
      chart_number INTEGER,
      sc_ts TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (playbook_id, signal_id)
    );
    CREATE INDEX IF NOT EXISTS playbook_signal_state_by_playbook
      ON playbook_signal_state(playbook_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS backtest_sweeps (
      id TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      param_grid_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      sweep_id TEXT,
      spec_json TEXT NOT NULL,
      params_override_json TEXT,
      chart_number INTEGER,
      study_id INTEGER,
      status TEXT NOT NULL,
      step TEXT,
      message TEXT,
      symbol TEXT,
      start_date TEXT,
      end_date TEXT,
      total_trades INTEGER,
      win_rate REAL,
      net_pnl REAL,
      profit_factor REAL,
      max_drawdown REAL,
      expectancy REAL,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS backtest_runs_by_playbook
      ON backtest_runs(playbook_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS backtest_runs_by_status
      ON backtest_runs(status, chart_number);

    CREATE TABLE IF NOT EXISTS sc_charts (
      chart_number INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT,
      include_in_backtest INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sc_profile (
      symbol TEXT NOT NULL,
      price REAL NOT NULL,
      bid_vol REAL NOT NULL DEFAULT 0,
      ask_vol REAL NOT NULL DEFAULT 0,
      total_vol REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, price)
    );
    CREATE INDEX IF NOT EXISTS sc_profile_by_symbol ON sc_profile(symbol, price DESC);

    CREATE TABLE IF NOT EXISTS sc_footprint (
      symbol TEXT NOT NULL,
      bar_index INTEGER NOT NULL,
      price REAL NOT NULL,
      bid_vol REAL NOT NULL DEFAULT 0,
      ask_vol REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, bar_index, price)
    );

    CREATE TABLE IF NOT EXISTS sc_chart_properties (
      symbol TEXT NOT NULL,
      chart_number INTEGER NOT NULL,
      bar_period_type INTEGER,
      bar_period_value INTEGER,
      session_start INTEGER,
      session_end INTEGER,
      tick_size REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, chart_number)
    );

    CREATE TABLE IF NOT EXISTS sc_replay_state (
      chart_number INTEGER PRIMARY KEY,
      running INTEGER NOT NULL DEFAULT 0,
      speed REAL,
      mode INTEGER,
      replay_datetime REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sc_drawings (
      chart_number INTEGER NOT NULL,
      drawing_id INTEGER NOT NULL,
      type_code INTEGER,
      p1_price REAL,
      p2_price REAL,
      text TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chart_number, drawing_id)
    );
  `);

  addCol("sc_market", "last_size", "REAL");
  addCol("sc_fills", "source_dtc", "INTEGER NOT NULL DEFAULT 0");
  addCol("sc_fills", "source_acsil", "INTEGER NOT NULL DEFAULT 0");
  addCol("sc_fills", "source_file", "INTEGER NOT NULL DEFAULT 0");
  addCol("sc_fills", "dtc_order_id", "TEXT");

  addCol("sc_trades", "source_dtc", "INTEGER NOT NULL DEFAULT 0");
  addCol("sc_trades", "source_acsil", "INTEGER NOT NULL DEFAULT 0");
  addCol("sc_trades", "source_file", "INTEGER NOT NULL DEFAULT 0");
  addCol("sc_trades", "backtest_run_id", "TEXT");
  try {
    db.exec(
      `CREATE INDEX IF NOT EXISTS sc_trades_by_backtest ON sc_trades(backtest_run_id, close_time)`
    );
  } catch {
    /* optional */
  }

  try {
    const chartCols = db
      .prepare(`PRAGMA table_info(sc_charts)`)
      .all() as Array<{ name: string; pk: number }>;
    const pkCols = chartCols.filter((c) => c.pk > 0);
    if (!chartCols.some((c) => c.name === "chartbook_key")) {
      db.exec(
        `ALTER TABLE sc_charts ADD COLUMN chartbook_key TEXT NOT NULL DEFAULT 'Platform'`
      );
    }
    if (pkCols.length === 1 && pkCols[0]?.name === "chart_number") {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sc_charts_v2 (
          chartbook_key TEXT NOT NULL,
          chart_number INTEGER NOT NULL,
          name TEXT NOT NULL,
          symbol TEXT,
          include_in_backtest INTEGER NOT NULL DEFAULT 0,
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (chartbook_key, chart_number)
        );
        INSERT OR REPLACE INTO sc_charts_v2 (
          chartbook_key, chart_number, name, symbol, include_in_backtest, last_seen_at
        )
        SELECT COALESCE(NULLIF(chartbook_key, ''), 'Platform'),
               chart_number, name, symbol, include_in_backtest, last_seen_at
        FROM sc_charts;
        DROP TABLE sc_charts;
        ALTER TABLE sc_charts_v2 RENAME TO sc_charts;
      `);
    }
  } catch {
    /* optional */
  }

  addCol("backtest_runs", "chartbook_key", "TEXT");

  /* ----------------------------- Intelligence ----------------------------- */
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
  try {
    db.prepare(`UPDATE ai_memories SET agent_id = 'intelligence' WHERE agent_id IS NULL`).run();
  } catch {
    /* optional */
  }

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
  try {
    db.prepare(
      `INSERT OR IGNORE INTO ai_agent_rule_state (agent_id, rule_id, enabled, priority_override, updated_at)
       SELECT 'intelligence', rule_id, enabled, priority_override, updated_at FROM ai_rule_state`
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO ai_agent_skill_state (agent_id, skill_id, enabled, last_used_at, updated_at)
       SELECT 'intelligence', skill_id, enabled, last_used_at, updated_at FROM ai_skill_state`
    ).run();
  } catch {
    /* optional */
  }

  // Seed default project + columns if empty
  try {
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
  } catch {
    /* optional */
  }

  // Seed the canonical autonomous task-runner workflow (idempotent). It is the
  // 12-step loop: check backlog → priority → in progress → plan subtasks → work
  // subtasks → review → comments → address → accept → done. Left enabled so the
  // user can run it from the queue / attach a cron schedule; no schedule is
  // auto-created to avoid surprising autonomous activity.
  try {
    const existing = db
      .prepare(`SELECT id FROM ai_workflows WHERE id = 'autonomous-task-runner'`)
      .get();
    if (!existing) {
      db.prepare(
        `INSERT INTO ai_workflows (id, name, config_json, enabled)
         VALUES ('autonomous-task-runner', 'Autonomous Task Runner', ?, 1)`
      ).run(JSON.stringify(AUTONOMOUS_TASK_RUNNER_GRAPH));
    }
  } catch {
    /* optional */
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
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS ai_calendar_events_user_idx
        ON ai_calendar_events(user_id, start_at);
      CREATE INDEX IF NOT EXISTS ai_projects_user_idx
        ON ai_projects(user_id);
    `);
  } catch {
    /* optional */
  }
  try {
    db.prepare(`UPDATE ai_workflows SET agent_id = 'intelligence' WHERE agent_id IS NULL`).run();
    db.prepare(`UPDATE ai_projects SET agent_id = 'intelligence' WHERE agent_id IS NULL AND user_id IS NULL`).run();
  } catch {
    /* optional */
  }

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

  try {
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
  } catch {
    /* optional */
  }

  addCol("sc_positions", "position_key", "TEXT");
  addCol("sc_positions", "source_dtc", "INTEGER NOT NULL DEFAULT 0");
  addCol("sc_positions", "source_acsil", "INTEGER NOT NULL DEFAULT 0");

  db.prepare(
    `UPDATE sc_positions SET position_key = playbook_id WHERE position_key IS NULL`
  ).run();
  try {
    db.prepare(`UPDATE sc_fills SET source_acsil = 1 WHERE source = 'acsil'`).run();
    db.prepare(`UPDATE sc_trades SET source_acsil = 1 WHERE source = 'acsil'`).run();
    db.prepare(`UPDATE sc_positions SET source_acsil = 1`).run();
  } catch {
    /* optional */
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
  createSchedule(db, {
    workflowId: "autonomous-task-runner",
    cronExpr: "*/30 * * * *",
    timezone: "America/Denver",
    enabled: true,
  });
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
