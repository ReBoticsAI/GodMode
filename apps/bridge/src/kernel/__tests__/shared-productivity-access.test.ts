import Database from "better-sqlite3";
import type { ObjectTypeDef } from "@godmode/kernel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantRegistry = vi.hoisted(() => ({
  databases: new Map<string, Database.Database>(),
}));

vi.mock("../../tenant-registry.js", () => ({
  getTenantDb(tenantId: string) {
    const db = tenantRegistry.databases.get(tenantId);
    if (!db) throw new Error(`Unknown tenant: ${tenantId}`);
    return db;
  },
}));

import {
  calendarEventServiceAdapter,
  taskCardServiceAdapter,
} from "../adapters/productivity.js";
import { shareGrantAdapter } from "../adapters/platform-actions.js";
import {
  createShareGrant,
  resolveShareAccess,
} from "../../services/share-service.js";

const taskDef: ObjectTypeDef = {
  name: "TaskCard",
  label: "Task Card",
  storage: { kind: "adapter", adapterId: "task_card_service" },
  fields: ["id", "project_id", "column_id", "title", "status", "sort_order"].map(
    (name) => ({ name, label: name, fieldType: "Data" })
  ),
};

const eventDef: ObjectTypeDef = {
  name: "CalendarEvent",
  label: "Calendar Event",
  storage: { kind: "adapter", adapterId: "calendar_event_service" },
  fields: ["id", "user_id", "title", "start_at", "status"].map((name) => ({
    name,
    label: name,
    fieldType: "Data",
  })),
};

function tenantDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ai_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, user_id TEXT, agent_id TEXT,
      archived_at TEXT,
      github_project_node_id TEXT,
      github_project_url TEXT,
      github_status_map_json TEXT,
      sync_enabled INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_project_columns (
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, sort_order INTEGER
    );
    CREATE TABLE ai_project_cards (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, column_id TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT, prompt TEXT, context_json TEXT,
      tags_json TEXT, due_at TEXT, linked_chat_id TEXT, linked_workflow_id TEXT,
      priority INTEGER, parent_card_id TEXT, status TEXT, assigned_agent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_card_comments (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, author TEXT NOT NULL,
      body TEXT NOT NULL, kind TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_calendar_events (
      id TEXT PRIMARY KEY, agent_id TEXT, user_id TEXT, kind TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT, start_at TEXT NOT NULL, end_at TEXT,
      all_day INTEGER NOT NULL DEFAULT 0, location TEXT, linked_card_id TEXT,
      linked_run_id TEXT, status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_workflows (
      id TEXT PRIMARY KEY, agent_id TEXT, name TEXT NOT NULL,
      config_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  for (const [id, name, order] of [
    ["backlog", "Backlog", 0],
    ["in_progress", "In Progress", 1],
    ["review", "Review", 2],
    ["done", "Done", 3],
  ] as const) {
    db.prepare(
      `INSERT INTO ai_project_columns (id, project_id, name, sort_order)
       VALUES (?, 'default', ?, ?)`
    ).run(id, name, order);
  }
  return db;
}

function coreDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE tenants (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE tenant_memberships (
      user_id TEXT, tenant_id TEXT, role TEXT,
      PRIMARY KEY (user_id, tenant_id)
    );
    CREATE TABLE share_grants (
      id TEXT PRIMARY KEY,
      owner_tenant_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      grantee_user_id TEXT,
      grantee_tenant_id TEXT,
      role TEXT NOT NULL,
      bridge_url TEXT,
      federation_token TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE bridge_connections (
      id TEXT PRIMARY KEY, owner_tenant_id TEXT, owner_user_id TEXT,
      label TEXT, mode TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE inference_endpoints (
      id TEXT PRIMARY KEY, owner_tenant_id TEXT, owner_user_id TEXT,
      status TEXT
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY, type TEXT, actor_kind TEXT, actor_id TEXT,
      tenant_id TEXT, payload_json TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  for (const id of ["owner-user", "viewer-user", "editor-user", "stranger-user"]) {
    db.prepare(`INSERT INTO users (id) VALUES (?)`).run(id);
  }
  db.prepare(`INSERT INTO tenants VALUES ('owner-tenant', 'owner-user')`).run();
  db.prepare(`INSERT INTO tenants VALUES ('viewer-tenant', 'viewer-user')`).run();
  db.prepare(`INSERT INTO tenants VALUES ('editor-tenant', 'editor-user')`).run();
  db.prepare(
    `INSERT INTO tenant_memberships VALUES ('owner-user', 'owner-tenant', 'owner')`
  ).run();
  db.prepare(
    `INSERT INTO tenant_memberships VALUES ('viewer-user', 'viewer-tenant', 'owner')`
  ).run();
  db.prepare(
    `INSERT INTO tenant_memberships VALUES ('editor-user', 'editor-tenant', 'owner')`
  ).run();
  return db;
}

function insertGrant(
  core: Database.Database,
  id: string,
  kind: "user_tasks" | "user_calendar" | "workflow",
  granteeUserId: string,
  role: "viewer" | "editor",
  resourceId = "owner-user",
  expiresAt: string | null = null
): void {
  core.prepare(
    `INSERT INTO share_grants
     (id, owner_tenant_id, owner_user_id, resource_kind, resource_id,
      grantee_user_id, role, expires_at)
     VALUES (?, 'owner-tenant', 'owner-user', ?, ?, ?, ?, ?)`
  ).run(id, kind, resourceId, granteeUserId, role, expiresAt);
}

describe("two-tenant shared productivity authorization", () => {
  let core: Database.Database;
  let ownerDb: Database.Database;
  let viewerDb: Database.Database;
  let editorDb: Database.Database;

  beforeEach(() => {
    tenantRegistry.databases.clear();
    core = coreDb();
    ownerDb = tenantDb();
    viewerDb = tenantDb();
    editorDb = tenantDb();
    tenantRegistry.databases.set("owner-tenant", ownerDb);
    tenantRegistry.databases.set("viewer-tenant", viewerDb);
    tenantRegistry.databases.set("editor-tenant", editorDb);

    ownerDb
      .prepare(`INSERT INTO ai_projects (id, name, user_id) VALUES ('owner-project', 'Tasks', 'owner-user')`)
      .run();
    ownerDb
      .prepare(
        `INSERT INTO ai_project_cards
         (id, project_id, column_id, title, status, sort_order)
         VALUES ('owner-card', 'owner-project', 'backlog', 'Owner task', 'pending', 0)`
      )
      .run();
    ownerDb
      .prepare(
        `INSERT INTO ai_calendar_events
         (id, agent_id, user_id, kind, title, start_at, status)
         VALUES ('owner-event', '', 'owner-user', 'event', 'Owner event',
                 '2026-07-15T09:00:00Z', 'scheduled')`
      )
      .run();
    viewerDb
      .prepare(`INSERT INTO ai_projects (id, name, user_id) VALUES ('viewer-project', 'Mine', 'viewer-user')`)
      .run();
  });

  it("creates grants only for an exact resource the caller can share", () => {
    expect(() =>
      createShareGrant(core, {
        ownerTenantId: "owner-tenant",
        ownerUserId: "owner-user",
        resourceKind: "user_tasks",
        resourceId: "viewer-user",
        granteeUserId: "viewer-user",
      })
    ).toThrow(/does not own/i);

    expect(() =>
      createShareGrant(core, {
        ownerTenantId: "owner-tenant",
        ownerUserId: "owner-user",
        resourceKind: "workflow",
        resourceId: "guessed-workflow",
        granteeUserId: "viewer-user",
      })
    ).toThrow(/not found/i);

    const grantId = createShareGrant(core, {
      ownerTenantId: "owner-tenant",
      ownerUserId: "owner-user",
      resourceKind: "user_tasks",
      resourceId: "owner-user",
      granteeUserId: "viewer-user",
      role: "viewer",
    });
    expect(
      core.prepare(`SELECT resource_id FROM share_grants WHERE id=?`).get(grantId)
    ).toEqual({ resource_id: "owner-user" });
  });

  it("gives viewers read parity but denies every shared mutation", async () => {
    insertGrant(core, "tasks-view", "user_tasks", "viewer-user", "viewer");
    insertGrant(core, "calendar-view", "user_calendar", "viewer-user", "viewer");
    const ctx = {
      tenantId: "viewer-tenant",
      userId: "viewer-user",
      role: "owner" as const,
      source: "http" as const,
      data: { tenantDb: viewerDb, coreDb: core, declaredDatabase: "tenant" as const },
    };

    expect(taskCardServiceAdapter.get!(viewerDb, taskDef, "owner-card", ctx)?.data.title).toBe(
      "Owner task"
    );
    expect(
      calendarEventServiceAdapter.get!(viewerDb, eventDef, "owner-event", ctx)?.data.title
    ).toBe("Owner event");
    expect(taskCardServiceAdapter.list!(viewerDb, taskDef, {}, ctx).records).toHaveLength(1);
    expect(calendarEventServiceAdapter.list!(viewerDb, eventDef, {}, ctx).records).toHaveLength(1);

    expect(() =>
      taskCardServiceAdapter.update!(viewerDb, taskDef, "owner-card", { title: "stolen" }, ctx)
    ).toThrow(/Requires editor/);
    expect(() =>
      taskCardServiceAdapter.delete!(viewerDb, taskDef, "owner-card", ctx)
    ).toThrow(/Requires editor/);
    expect(() =>
      taskCardServiceAdapter.actions!.transition(
        viewerDb,
        taskDef,
        "owner-card",
        { status: "done" },
        ctx
      )
    ).toThrow(/Requires editor/);
    expect(() =>
      calendarEventServiceAdapter.update!(
        viewerDb,
        eventDef,
        "owner-event",
        { title: "stolen" },
        ctx
      )
    ).toThrow(/Requires editor/);
  });

  it("routes editor mutations to the owner DB without exposing guessed local IDs", async () => {
    insertGrant(core, "tasks-edit", "user_tasks", "editor-user", "editor");
    insertGrant(core, "calendar-edit", "user_calendar", "editor-user", "editor");
    editorDb
      .prepare(
        `INSERT INTO ai_calendar_events
         (id, agent_id, user_id, kind, title, start_at, status)
         VALUES ('foreign-local', '', 'stranger-user', 'event', 'Hidden',
                 '2026-07-15T10:00:00Z', 'scheduled')`
      )
      .run();
    const ctx = {
      tenantId: "editor-tenant",
      userId: "editor-user",
      role: "owner" as const,
      source: "http" as const,
      data: { tenantDb: editorDb, coreDb: core, declaredDatabase: "tenant" as const },
    };

    taskCardServiceAdapter.update!(
      editorDb,
      taskDef,
      "owner-card",
      { title: "Edited through grant" },
      ctx
    );
    await calendarEventServiceAdapter.actions!.transition(
      editorDb,
      eventDef,
      "owner-event",
      { status: "completed" },
      ctx
    );
    expect(ownerDb.prepare(`SELECT title FROM ai_project_cards WHERE id='owner-card'`).get()).toEqual(
      { title: "Edited through grant" }
    );
    expect(
      ownerDb.prepare(`SELECT status FROM ai_calendar_events WHERE id='owner-event'`).get()
    ).toEqual({ status: "completed" });
    expect(calendarEventServiceAdapter.get!(editorDb, eventDef, "foreign-local", ctx)).toBeNull();
    expect(taskCardServiceAdapter.get!(editorDb, taskDef, "guessed-id", ctx)).toBeNull();
  });

  it("fails closed for missing, revoked, expired, wrong-resource, and clone access", async () => {
    insertGrant(
      core,
      "expired",
      "user_tasks",
      "viewer-user",
      "viewer",
      "owner-user",
      "2000-01-01T00:00:00Z"
    );
    expect(
      resolveShareAccess(core, {
        userId: "viewer-user",
        tenantId: "viewer-tenant",
        resourceKind: "user_tasks",
        resourceId: "owner-user",
      })
    ).toBeNull();

    core.prepare(`DELETE FROM share_grants WHERE id='expired'`).run();
    insertGrant(core, "revoked", "user_tasks", "viewer-user", "viewer");
    core.prepare(`DELETE FROM share_grants WHERE id='revoked'`).run();
    expect(
      resolveShareAccess(core, {
        userId: "viewer-user",
        tenantId: "viewer-tenant",
        resourceKind: "user_tasks",
        resourceId: "owner-user",
      })
    ).toBeNull();

    insertGrant(core, "wrong-kind", "user_calendar", "viewer-user", "viewer");
    const ctx = {
      tenantId: "viewer-tenant",
      userId: "viewer-user",
      role: "owner" as const,
      source: "http" as const,
      data: { tenantDb: viewerDb, coreDb: core, declaredDatabase: "core" as const },
    };
    expect(taskCardServiceAdapter.get!(viewerDb, taskDef, "owner-card", ctx)).toBeNull();

    expect(() =>
      shareGrantAdapter.actions!.clone_shared(
        viewerDb,
        {} as ObjectTypeDef,
        "",
        { kind: "workflow", resource_id: "guessed-workflow" },
        ctx
      )
    ).toThrow(/No access/);
  });
});
