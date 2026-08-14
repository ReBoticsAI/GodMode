import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import type { CoreDatabase } from "../../core-db.js";
import { promoteSupportTicketToCard } from "../support-to-kanban.js";

function openTenantDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE ai_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      agent_id TEXT,
      columns_json TEXT,
      archived_at TEXT,
      sync_enabled INTEGER DEFAULT 0,
      github_project_node_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_project_columns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE ai_project_cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      prompt TEXT,
      context_json TEXT,
      tags_json TEXT,
      due_at TEXT,
      linked_chat_id TEXT,
      linked_workflow_id TEXT,
      priority INTEGER DEFAULT 2,
      parent_card_id TEXT,
      status TEXT,
      assigned_agent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function openHubDb(): CoreDatabase {
  const db = new Database(":memory:") as unknown as CoreDatabase;
  db.exec(`
    CREATE TABLE support_tickets (
      id TEXT PRIMARY KEY,
      requester_kind TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      requester_tenant_id TEXT,
      subject TEXT NOT NULL,
      body TEXT,
      category TEXT,
      priority TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      target_kind TEXT,
      shared_grant_id TEXT,
      owner_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO support_tickets
      (id, requester_kind, requester_id, subject, body, status, target_kind)
     VALUES ('t1', 'user', 'u1', 'Crash on save', 'Details here', 'open', 'platform_admin')`
  ).run();
  return db;
}

describe("promoteSupportTicketToCard", () => {
  it("creates an auto-tagged Kanban card linked to the support ticket", () => {
    const tenantDb = openTenantDb();
    const hubDb = openHubDb();
    const result = promoteSupportTicketToCard({
      tenantDb,
      hubDb,
      ticketId: "t1",
      userId: "u1",
      agentId: "intelligence",
    });
    expect(result.supportTicketId).toBe("t1");
    expect(result.title).toMatch(/Crash on save/);
    const row = tenantDb
      .prepare(`SELECT * FROM ai_project_cards WHERE id=?`)
      .get(result.cardId) as {
      tags_json: string;
      context_json: string;
      prompt: string;
    };
    expect(JSON.parse(row.tags_json)).toEqual(
      expect.arrayContaining(["auto", "support", "release-followup"])
    );
    expect(JSON.parse(row.context_json).support_ticket_id).toBe("t1");
    expect(row.prompt).toMatch(/support ticket t1/i);
  });
});
