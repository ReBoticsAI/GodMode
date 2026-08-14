import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import {
  beginActiveWorkRunCard,
  completeActiveWorkRunCard,
  sanitizeRunCardUserMessage,
} from "../active-work-run-card.js";
import { broadcastCardActivity } from "../../ws-broker.js";

vi.mock("../../ws-broker.js", () => ({
  broadcastCardActivity: vi.fn(),
}));

function makeDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE ai_projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      user_id TEXT,
      agent_id TEXT,
      columns_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_project_columns (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT,
      sort_order INTEGER
    );
    CREATE TABLE ai_project_cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      context_json TEXT,
      linked_chat_id TEXT,
      assigned_agent_id TEXT,
      parent_card_id TEXT,
      status TEXT,
      priority INTEGER DEFAULT 2,
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
  `);
  return db;
}

describe("sanitizeRunCardUserMessage", () => {
  it("strips accidental undefined prefixes", () => {
    expect(sanitizeRunCardUserMessage("undefinedFor dogfood")).toBe(
      "For dogfood"
    );
    expect(sanitizeRunCardUserMessage("undefined Build a plugin")).toBe(
      "Build a plugin"
    );
    expect(sanitizeRunCardUserMessage("Build a plugin")).toBe("Build a plugin");
  });
});

describe("beginActiveWorkRunCard", () => {
  it("creates a host card and broadcasts begin", () => {
    const db = makeDb();
    vi.mocked(broadcastCardActivity).mockClear();
    const res = beginActiveWorkRunCard({
      db,
      agentId: "intelligence",
      chatId: "chat-new",
      userMessage: "Ship nested clone fix",
      tenantId: "t1",
    });
    expect(res.cardId).toBe("run_chat-new");
    expect(res.projectId).toBe("default");
    const row = db
      .prepare(
        `SELECT project_id, column_id, context_json FROM ai_project_cards WHERE id=?`
      )
      .get(res.cardId) as {
      project_id: string;
      column_id: string;
      context_json: string;
    };
    expect(row.project_id).toBe("default");
    expect(row.column_id).toBe("in_progress");
    expect(JSON.parse(row.context_json).__activeWorkRun).toBe(true);
    expect(broadcastCardActivity).toHaveBeenCalledWith("t1", {
      cardId: res.cardId,
      reason: "active-work-begin",
    });
  });

  it("remaps project_id when the card exists under another board", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO ai_projects (id, name, agent_id, columns_json) VALUES ('old', 'Old', 'other', ?)`
    ).run("[]");
    db.prepare(
      `INSERT INTO ai_project_cards
       (id, project_id, column_id, title, context_json, status)
       VALUES ('run_remap', 'old', 'backlog', 'Stale', ?, 'pending')`
    ).run(JSON.stringify({ __activeWorkRun: true, chatId: "remap" }));

    const res = beginActiveWorkRunCard({
      db,
      agentId: "intelligence",
      chatId: "remap",
      userMessage: "Continue",
    });
    expect(res.projectId).toBe("default");
    const row = db
      .prepare(`SELECT project_id, column_id, status FROM ai_project_cards WHERE id=?`)
      .get("run_remap") as {
      project_id: string;
      column_id: string;
      status: string;
    };
    expect(row.project_id).toBe("default");
    expect(row.column_id).toBe("in_progress");
    expect(row.status).toBe("working");
  });
});

describe("completeActiveWorkRunCard", () => {
  it("moves host run + open todos to Done and records activity", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO ai_project_cards
       (id, project_id, column_id, title, context_json, status)
       VALUES ('run_chat1', 'proj', 'in_progress', 'Build plugin', ?, 'working')`
    ).run(JSON.stringify({ __activeWorkRun: true, chatId: "chat1" }));
    db.prepare(
      `INSERT INTO ai_project_cards
       (id, project_id, column_id, title, parent_card_id, status)
       VALUES ('run_chat1__scaffold', 'proj', 'in_progress', 'Scaffold', 'run_chat1', 'working')`
    ).run();
    db.prepare(
      `INSERT INTO ai_project_cards
       (id, project_id, column_id, title, parent_card_id, status)
       VALUES ('run_chat1__install', 'proj', 'backlog', 'Install', 'run_chat1', 'pending')`
    ).run();

    expect(
      completeActiveWorkRunCard({
        db,
        cardId: "run_chat1",
        tenantId: "t1",
        outcome: "success",
      })
    ).toBe(true);

    const parent = db
      .prepare(`SELECT column_id, status FROM ai_project_cards WHERE id = ?`)
      .get("run_chat1") as { column_id: string; status: string };
    expect(parent.column_id).toBe("done");
    expect(parent.status).toBe("accepted");

    const open = db
      .prepare(
        `SELECT COUNT(*) AS c FROM ai_project_cards
         WHERE parent_card_id = ? AND column_id != 'done'`
      )
      .get("run_chat1") as { c: number };
    expect(open.c).toBe(0);

    const comments = db
      .prepare(
        `SELECT kind, body FROM ai_card_comments WHERE card_id = ? ORDER BY created_at`
      )
      .all("run_chat1") as Array<{ kind: string; body: string }>;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.kind).toBe("result");
    expect(comments[0]!.body.toLowerCase()).toMatch(/finished|closed/);
  });

  it("records an issue comment on abort without forcing Done", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO ai_project_cards
       (id, project_id, column_id, title, context_json, status)
       VALUES ('run_chat2', 'proj', 'in_progress', 'Build plugin', ?, 'working')`
    ).run(JSON.stringify({ __activeWorkRun: true, chatId: "chat2" }));

    expect(
      completeActiveWorkRunCard({
        db,
        cardId: "run_chat2",
        outcome: "aborted",
      })
    ).toBe(true);

    const parent = db
      .prepare(`SELECT column_id, status FROM ai_project_cards WHERE id = ?`)
      .get("run_chat2") as { column_id: string; status: string };
    expect(parent.column_id).toBe("in_progress");
    expect(parent.status).toBe("working");

    const comments = db
      .prepare(`SELECT kind FROM ai_card_comments WHERE card_id = ?`)
      .all("run_chat2") as Array<{ kind: string }>;
    expect(comments[0]!.kind).toBe("issue");
  });
});
