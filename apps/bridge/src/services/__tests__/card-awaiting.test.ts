/**
 * Lightweight validation for card awaiting + backtest terminal resume wiring.
 * Run: npx tsx apps/bridge/src/services/__tests__/card-awaiting.test.ts
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import {
  clearCardAwaiting,
  findCardsAwaitingRef,
  isBacktestInFlightStatus,
  isBacktestTerminalStatus,
  markCardAwaitingTerminal,
  readCardAwaiting,
  setCardAwaiting,
} from "../card-awaiting.js";

function makeTestDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE ai_project_cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      context_json TEXT,
      parent_card_id TEXT,
      status TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_card_comments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      author TEXT,
      body TEXT,
      kind TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_prompt_queue (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 5,
      workflow_id TEXT,
      adapter_ids_json TEXT,
      prompt TEXT,
      context_json TEXT,
      result_json TEXT,
      error TEXT,
      tenant_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );
    CREATE TABLE ai_workflows (id TEXT PRIMARY KEY, name TEXT, definition_json TEXT, enabled INTEGER);
    INSERT INTO ai_workflows (id, name, definition_json, enabled) VALUES ('autonomous-task-runner', 'test', '{}', 1);
  `);
  return db;
}

function testAwaitingRoundTrip(): void {
  const db = makeTestDb();
  db.prepare(
    `INSERT INTO ai_project_cards (id, project_id, column_id, title, parent_card_id)
     VALUES ('sub-1', 'proj', 'in_progress', 'Baseline backtest', 'parent-1')`
  ).run();

  setCardAwaiting(db, "sub-1", {
    kind: "backtest",
    refId: "run-abc",
    startedAt: new Date().toISOString(),
    playbookId: "pb1",
    parentTaskId: "parent-1",
  });

  const found = findCardsAwaitingRef(db, "backtest", "run-abc");
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "sub-1");

  const awaiting = readCardAwaiting(found[0]);
  assert.ok(awaiting);
  assert.equal(awaiting.refId, "run-abc");

  markCardAwaitingTerminal(db, "sub-1", {
    terminalStatus: "done",
    totalTrades: 42,
    netPnl: 100,
    profitFactor: 1.5,
  });
  const ready = readCardAwaiting(
    db
      .prepare(`SELECT context_json FROM ai_project_cards WHERE id = ?`)
      .get("sub-1") as { context_json: string | null }
  );
  assert.equal(ready?.resumeReady, true);
  assert.equal(ready?.totalTrades, 42);

  clearCardAwaiting(db, "sub-1");
  const cleared = db
    .prepare(`SELECT context_json FROM ai_project_cards WHERE id = ?`)
    .get("sub-1") as { context_json: string | null };
  assert.equal(readCardAwaiting(cleared), null);
}

function testTerminalStatusHelpers(): void {
  assert.equal(isBacktestInFlightStatus("running"), true);
  assert.equal(isBacktestInFlightStatus("done"), false);
  assert.equal(isBacktestTerminalStatus("done"), true);
  assert.equal(isBacktestTerminalStatus("running"), false);
}

function testExecutorAwaitingGateSimulation(): void {
  // Simulates autonomous-executor pre-turn gate: in-flight → skip; terminal → resume.
  const db = makeTestDb();
  db.exec(`
    CREATE TABLE backtest_runs (id TEXT PRIMARY KEY, status TEXT);
    INSERT INTO backtest_runs (id, status) VALUES ('run-live', 'running');
  `);
  db.prepare(
    `INSERT INTO ai_project_cards (id, project_id, column_id, title, parent_card_id, context_json)
     VALUES ('sub-3', 'proj', 'in_progress', 'Baseline run', 'parent-3', ?)`
  ).run(
    JSON.stringify({
      __awaiting: {
        kind: "backtest",
        refId: "run-live",
        startedAt: new Date().toISOString(),
      },
    })
  );

  const row = db
    .prepare(`SELECT status FROM backtest_runs WHERE id = ?`)
    .get("run-live") as { status: string };
  assert.equal(isBacktestInFlightStatus(row.status), true);

  db.prepare(`UPDATE backtest_runs SET status = 'done' WHERE id = ?`).run("run-live");
  const doneRow = db
    .prepare(`SELECT status FROM backtest_runs WHERE id = ?`)
    .get("run-live") as { status: string };
  assert.equal(isBacktestTerminalStatus(doneRow.status), true);
}

testAwaitingRoundTrip();
testTerminalStatusHelpers();
testExecutorAwaitingGateSimulation();
console.log("card-awaiting.test.ts: all assertions passed");
