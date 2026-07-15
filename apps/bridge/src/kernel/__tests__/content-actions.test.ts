import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { ObjectTypeDef } from "@godmode/kernel";
import type { OperationContext } from "../adapter-registry.js";
import {
  artifactServiceAdapter,
  memoryServiceAdapter,
  notificationServiceAdapter,
  reflectionProposalServiceAdapter,
  ruleServiceAdapter,
  skillServiceAdapter,
  wikiProposalServiceAdapter,
} from "../adapters/content.js";

function def(name: string, adapterId: string): ObjectTypeDef {
  return {
    name,
    label: name,
    storage: { kind: "adapter", adapterId },
    fields: [],
  };
}

const memoryDef = def("Memory", "memory_service");
const notificationDef = def("Notification", "notification_service");
const reflectionDef = def(
  "ReflectionProposal",
  "reflection_proposal_service"
);
const wikiProposalDef = def("WikiProposal", "wiki_proposal_service");

function ctx(
  db: Database.Database,
  overrides: Partial<OperationContext> = {}
): OperationContext {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    agentId: "agent-a",
    role: "owner",
    source: "agent",
    data: {
      tenantDb: db,
      coreDb: db,
      declaredDatabase: "tenant",
    },
    ...overrides,
  };
}

describe("content ObjectType adapters", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ai_memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        scope TEXT NOT NULL,
        chat_id TEXT,
        text TEXT NOT NULL,
        category TEXT,
        source TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        pack_id TEXT,
        valid_from TEXT,
        valid_until TEXT,
        embedding BLOB,
        embedding_dim INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE VIRTUAL TABLE ai_memories_fts USING fts5(memory_id UNINDEXED, text);

      CREATE TABLE ai_reflection_proposals (
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

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        recipient_kind TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        recipient_tenant_id TEXT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        link TEXT,
        resource_kind TEXT,
        resource_id TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE wiki_page_proposals (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        action TEXT NOT NULL,
        space TEXT,
        slug TEXT,
        title TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        target_page_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  it("exports service adapters with handlers kept on actions", () => {
    expect([
      memoryServiceAdapter.id,
      ruleServiceAdapter.id,
      skillServiceAdapter.id,
      artifactServiceAdapter.id,
      wikiProposalServiceAdapter.id,
      reflectionProposalServiceAdapter.id,
      notificationServiceAdapter.id,
    ]).toEqual([
      "memory_service",
      "rule_service",
      "skill_service",
      "artifact_service",
      "wiki_proposal_service",
      "reflection_proposal_service",
      "notification_service",
    ]);
    expect(Object.keys(memoryServiceAdapter.actions ?? {})).toEqual([
      "approve",
      "reject",
    ]);
    expect(Object.keys(notificationServiceAdapter.actions ?? {})).toEqual([
      "mark_read",
      "mark_all_read",
      "clear",
    ]);
  });

  it("scopes memory CRUD to the active agent and maintains FTS", () => {
    const owner = ctx(db);
    const created = memoryServiceAdapter.create!(
      db,
      memoryDef,
      { text: "private launch phrase", status: "pending" },
      owner
    );
    expect(created.data.agent_id).toBe("agent-a");
    expect(
      memoryServiceAdapter.get!(
        db,
        memoryDef,
        created.id,
        ctx(db, { agentId: "agent-b" })
      )
    ).toBeNull();

    memoryServiceAdapter.actions!.approve(
      db,
      memoryDef,
      created.id,
      {},
      owner
    );
    expect(
      db
        .prepare(
          `SELECT memory_id FROM ai_memories_fts
           WHERE ai_memories_fts MATCH 'launch'`
        )
        .get()
    ).toEqual({ memory_id: created.id });

    memoryServiceAdapter.delete!(db, memoryDef, created.id, owner);
    expect(
      db.prepare(`SELECT 1 FROM ai_memories_fts WHERE memory_id = ?`).get(created.id)
    ).toBeUndefined();
  });

  it("prevents cross-agent reflection lifecycle actions", () => {
    db.prepare(
      `INSERT INTO ai_reflection_proposals
       (id, agent_id, kind, target_id, action, payload_json, status)
       VALUES (?, ?, 'memory', 'm1', 'delete', '{}', 'pending')`
    ).run("proposal-b", "agent-b");

    expect(
      reflectionProposalServiceAdapter.get!(
        db,
        reflectionDef,
        "proposal-b",
        ctx(db)
      )
    ).toBeNull();
    expect(() =>
      reflectionProposalServiceAdapter.actions!.reject(
        db,
        reflectionDef,
        "proposal-b",
        {},
        ctx(db)
      )
    ).toThrow(/not found/i);
    expect(
      db
        .prepare(`SELECT status FROM ai_reflection_proposals WHERE id = ?`)
        .get("proposal-b")
    ).toEqual({ status: "pending" });
  });

  it("marks and clears only the current recipient's notifications", () => {
    const insert = db.prepare(
      `INSERT INTO notifications
       (id, recipient_kind, recipient_id, recipient_tenant_id, category, title)
       VALUES (?, 'user', ?, 'tenant-a', 'system', ?)`
    );
    insert.run("mine-unread", "user-a", "Mine unread");
    insert.run("mine-read", "user-a", "Mine read");
    insert.run("theirs", "user-b", "Theirs");
    db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ?`).run(
      "mine-read"
    );
    const userCtx = ctx(db, { source: "http", agentId: undefined });

    notificationServiceAdapter.actions!.mark_read(
      db,
      notificationDef,
      "mine-unread",
      {},
      userCtx
    );
    const cleared = notificationServiceAdapter.actions!.clear(
      db,
      notificationDef,
      "",
      {},
      userCtx
    );
    expect(cleared).toEqual({ deleted: 2 });
    expect(
      db.prepare(`SELECT id FROM notifications ORDER BY id`).all()
    ).toEqual([{ id: "theirs" }]);
  });

  it("tenant-scopes wiki proposal rejection", () => {
    const insert = db.prepare(
      `INSERT INTO wiki_page_proposals
       (id, tenant_id, action, title, body_markdown, source)
       VALUES (?, ?, 'create', ?, '', 'test')`
    );
    insert.run("proposal-a", "tenant-a", "A");
    insert.run("proposal-b", "tenant-b", "B");

    expect(
      wikiProposalServiceAdapter.get!(
        db,
        wikiProposalDef,
        "proposal-b",
        ctx(db)
      )
    ).toBeNull();
    wikiProposalServiceAdapter.actions!.reject(
      db,
      wikiProposalDef,
      "proposal-a",
      {},
      ctx(db)
    );
    expect(
      db
        .prepare(`SELECT status FROM wiki_page_proposals WHERE id = ?`)
        .get("proposal-a")
    ).toEqual({ status: "rejected" });
  });
});
