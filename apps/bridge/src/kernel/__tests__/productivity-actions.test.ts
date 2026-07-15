import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import type { ObjectTypeDef } from "@godmode/kernel";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CALENDAR_EVENT_ACTIONS,
  CARD_COMMENT_ACTIONS,
  TASK_CARD_ACTIONS,
  calendarEventServiceAdapter,
  cardCommentServiceAdapter,
  taskCardServiceAdapter,
} from "../adapters/productivity.js";

const taskDef: ObjectTypeDef = {
  name: "TaskCard",
  label: "Task Card",
  storage: { kind: "adapter", adapterId: taskCardServiceAdapter.id },
  fields: [
    "id",
    "project_id",
    "column_id",
    "title",
    "parent_card_id",
    "status",
    "assigned_agent_id",
    "sort_order",
    "linked_chat_id",
  ].map((name) => ({ name, label: name, fieldType: "Data" })),
};

const commentDef: ObjectTypeDef = {
  name: "CardComment",
  label: "Card Comment",
  storage: { kind: "adapter", adapterId: cardCommentServiceAdapter.id },
  fields: ["id", "card_id", "author", "body", "kind", "created_at"].map(
    (name) => ({ name, label: name, fieldType: "Data" })
  ),
};

const eventDef: ObjectTypeDef = {
  name: "CalendarEvent",
  label: "Calendar Event",
  storage: { kind: "adapter", adapterId: calendarEventServiceAdapter.id },
  fields: ["id", "user_id", "title", "start_at", "status"].map((name) => ({
    name,
    label: name,
    fieldType: "Data",
  })),
};

const owner = {
  tenantId: "owner-tenant",
  userId: "owner-user",
  role: "owner" as const,
  source: "http" as const,
  bus: new EventEmitter(),
};

describe("productivity adapter actions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
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

  it("exports the exact action-capable adapter contracts", () => {
    expect(Object.keys(taskCardServiceAdapter.actions ?? {})).toEqual([
      "move",
      "assign",
      "transition",
      "add_comment",
    ]);
    expect(TASK_CARD_ACTIONS.map((action) => action.name)).toEqual([
      "move",
      "assign",
      "transition",
      "add_comment",
    ]);
    expect(Object.keys(cardCommentServiceAdapter.actions ?? {})).toEqual([
      "add_comment",
    ]);
    expect(CARD_COMMENT_ACTIONS[0]).toMatchObject({
      name: "add_comment",
      target: "collection",
      effect: "write",
    });
    expect(CALENDAR_EVENT_ACTIONS[0]).toMatchObject({
      name: "transition",
      target: "record",
      effect: "write",
    });
  });

  it("moves, assigns, and transitions only owner-scoped cards", async () => {
    const card = taskCardServiceAdapter.create!(db, taskDef, { title: "Scoped" }, owner);
    const completed: unknown[] = [];
    owner.bus.on("card_completed", (event) => completed.push(event));

    const moved = await taskCardServiceAdapter.actions!.move(
      db,
      taskDef,
      card.id,
      { column_id: "in_progress" },
      owner
    );
    expect((moved as { data: Record<string, unknown> }).data).toMatchObject({
      column_id: "in_progress",
    });

    const assigned = await taskCardServiceAdapter.actions!.assign(
      db,
      taskDef,
      card.id,
      { assigned_agent_id: "agent-7" },
      owner
    );
    expect((assigned as { data: Record<string, unknown> }).data.assigned_agent_id).toBe(
      "agent-7"
    );

    const transitioned = await taskCardServiceAdapter.actions!.transition(
      db,
      taskDef,
      card.id,
      { status: "accepted" },
      owner
    );
    expect((transitioned as { data: Record<string, unknown> }).data).toMatchObject({
      column_id: "done",
      status: "accepted",
    });
    expect(completed).toEqual([{ cardId: card.id, agentId: "agent-7" }]);

    expect(() =>
      taskCardServiceAdapter.actions!.move(
        db,
        taskDef,
        card.id,
        { column_id: "backlog" },
        { ...owner, userId: "other-user" }
      )
    ).toThrow(/TaskCard not found/);
  });

  it("adds scoped comments and preserves subtask progress invariants", async () => {
    const parent = taskCardServiceAdapter.create!(
      db,
      taskDef,
      { title: "Parent" },
      owner
    );
    const first = taskCardServiceAdapter.create!(
      db,
      taskDef,
      { title: "First", parent_card_id: parent.id },
      owner
    );
    const second = taskCardServiceAdapter.create!(
      db,
      taskDef,
      { title: "Second", parent_card_id: parent.id },
      owner
    );

    const comment = await taskCardServiceAdapter.actions!.add_comment(
      db,
      taskDef,
      first.id,
      { body: "Finished the first step", kind: "result" },
      { ...owner, source: "agent", agentId: "worker" }
    );
    expect((comment as { data: Record<string, unknown> }).data).toMatchObject({
      card_id: first.id,
      author: "agent",
      kind: "result",
    });
    expect(
      db.prepare(`SELECT column_id, status FROM ai_project_cards WHERE id=?`).get(first.id)
    ).toEqual({ column_id: "done", status: "accepted" });
    expect(
      db.prepare(`SELECT column_id, status FROM ai_project_cards WHERE id=?`).get(second.id)
    ).toEqual({ column_id: "in_progress", status: "working" });

    expect(() =>
      cardCommentServiceAdapter.actions!.add_comment(
        db,
        commentDef,
        "",
        { card_id: first.id, body: "Cross-tenant attempt" },
        { ...owner, userId: "other-user" }
      )
    ).toThrow(/TaskCard not found/);
  });

  it("transitions only the authenticated user's calendar events", async () => {
    const event = calendarEventServiceAdapter.create!(
      db,
      eventDef,
      { title: "Review", start_at: "2026-07-15T09:00:00Z" },
      owner
    );
    const transitioned = await calendarEventServiceAdapter.actions!.transition(
      db,
      eventDef,
      event.id,
      { status: "completed" },
      owner
    );
    expect((transitioned as { data: Record<string, unknown> }).data.status).toBe(
      "completed"
    );
    expect(() =>
      calendarEventServiceAdapter.actions!.transition(
        db,
        eventDef,
        event.id,
        { status: "cancelled" },
        { ...owner, userId: "other-user" }
      )
    ).toThrow(/CalendarEvent not found/);
  });
});
