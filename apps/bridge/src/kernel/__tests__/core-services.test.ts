import Database from "better-sqlite3";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createRecord,
  deleteRecord,
  getRecord,
  updateRecord,
} from "../record-api.js";
import { registerCoreObjectTypes } from "../core-object-types.js";

const ctx = {
  tenantId: "tenant-services",
  userId: "user-services",
  role: "owner" as const,
  source: "http" as const,
};

describe("core service ObjectType adapters", () => {
  let db: Database.Database;

  beforeAll(() => registerCoreObjectTypes());

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ai_agents (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT,
        backend TEXT NOT NULL, enabled INTEGER NOT NULL, is_template INTEGER NOT NULL,
        system_prompt TEXT NOT NULL, sampling_json TEXT NOT NULL, thinking_json TEXT NOT NULL,
        tool_allow_json TEXT, auto_approve_json TEXT, model_path TEXT,
        adapter_ids_json TEXT, config_json TEXT, parent_id TEXT, team TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_workflows (
        id TEXT PRIMARY KEY, agent_id TEXT, name TEXT NOT NULL, config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_schedules (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, cron_expr TEXT NOT NULL,
        timezone TEXT NOT NULL, enabled INTEGER NOT NULL, last_run_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_workflow_comments (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, author TEXT NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, user_id TEXT, agent_id TEXT,
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
    `);
  });

  it("preserves workflow service validation and safe edits", () => {
    const created = createRecord(
      db,
      "Workflow",
      {
        name: "Metadata workflow",
        config_json: { nodes: [], edges: [] },
        enabled: true,
      },
      ctx
    );
    expect(created.data).toMatchObject({
      name: "Metadata workflow",
      enabled: true,
    });
    expect(
      updateRecord(db, "Workflow", created.id, { name: "Updated workflow" }, ctx)
        .data.name
    ).toBe("Updated workflow");
    deleteRecord(db, "Workflow", created.id, ctx);
    expect(() => getRecord(db, "Workflow", created.id, ctx)).toThrow(
      /record not found/i
    );
  });

  it("reloads schedule definitions through service CRUD", () => {
    const workflow = createRecord(
      db,
      "Workflow",
      { name: "Scheduled", config_json: { nodes: [], edges: [] } },
      ctx
    );
    const schedule = createRecord(
      db,
      "Schedule",
      {
        workflow_id: workflow.id,
        cron_expr: "0 9 * * *",
        timezone: "America/Denver",
        enabled: true,
      },
      ctx
    );
    expect(schedule.data).toMatchObject({
      workflow_id: workflow.id,
      enabled: true,
    });
  });

  it("persists workflow comments through the workflow service", () => {
    const workflow = createRecord(
      db,
      "Workflow",
      { name: "Reviewed", config_json: { nodes: [], edges: [] } },
      ctx
    );
    const comment = createRecord(
      db,
      "WorkflowComment",
      { workflow_id: workflow.id, author: "user", body: "Ship this" },
      ctx
    );
    expect(comment.data).toMatchObject({
      workflow_id: workflow.id,
      author: "user",
      body: "Ship this",
    });
    deleteRecord(db, "WorkflowComment", comment.id, ctx);
    expect(() => getRecord(db, "WorkflowComment", comment.id, ctx)).toThrow(
      /record not found/i
    );
  });

  it("uses the authoritative Agent service and protects built-ins", () => {
    const agent = createRecord(
      db,
      "Agent",
      { id: "metadata-agent", name: "Metadata Agent", backend: "local" },
      ctx
    );
    expect(agent.data).toMatchObject({
      name: "Metadata Agent",
      enabled: true,
      is_template: false,
    });
    expect(
      updateRecord(
        db,
        "Agent",
        agent.id,
        { team: "Operations" },
        ctx
      ).data
    ).toMatchObject({ team: "Operations" });
  });

  it("scopes productivity edits to the active user", () => {
    const event = createRecord(
      db,
      "CalendarEvent",
      {
        title: "Kernel review",
        start_at: "2026-07-15T09:00:00Z",
        all_day: false,
      },
      ctx
    );
    expect(event.data.title).toBe("Kernel review");
    const card = createRecord(db, "TaskCard", { title: "Ship metadata" }, ctx);
    expect(() =>
      createRecord(
        db,
        "CardComment",
        { card_id: card.id, body: "Validated" },
        ctx
      )
    ).toThrow(/create is disabled/i);
    expect(() =>
      getRecord(db, "TaskCard", card.id, {
        ...ctx,
        userId: "another-user",
      })
    ).toThrow(/not found/i);
    deleteRecord(db, "TaskCard", card.id, ctx);
    expect(() => getRecord(db, "TaskCard", card.id, ctx)).toThrow(/not found/i);
  });
});
