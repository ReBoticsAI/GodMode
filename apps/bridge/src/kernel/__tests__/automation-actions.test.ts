import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectTypeDef } from "@godmode/kernel";

const mocks = vi.hoisted(() => ({
  coreDb: null as unknown as Database.Database,
  refreshScheduler: vi.fn(),
  approveHookRun: vi.fn(async () => undefined),
  rejectHookRun: vi.fn(),
}));

vi.mock("../../core-db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core-db.js")>();
  return { ...actual, getCoreDb: () => mocks.coreDb };
});

vi.mock("../../services/scheduler.js", () => ({
  refreshScheduler: mocks.refreshScheduler,
}));

vi.mock("../../services/hook-dispatcher.js", () => ({
  approveHookRun: mocks.approveHookRun,
  rejectHookRun: mocks.rejectHookRun,
}));

import {
  agentServiceAdapter,
  hookRunServiceAdapter,
  hookServiceAdapter,
  scheduleServiceAdapter,
  workflowRunServiceAdapter,
  workflowServiceAdapter,
} from "../adapters/core-services.js";

const ctx = {
  tenantId: "tenant-actions",
  userId: "user-actions",
  role: "owner" as const,
  source: "http" as const,
};

function def(name: string): ObjectTypeDef {
  return {
    name,
    label: name,
    storage: { kind: "adapter", adapterId: `${name}_test` },
    fields: [],
  };
}

describe("safe automation service actions", () => {
  let db: Database.Database;

  beforeEach(() => {
    mocks.refreshScheduler.mockClear();
    mocks.approveHookRun.mockClear();
    mocks.rejectHookRun.mockClear();
    db = new Database(":memory:");
    mocks.coreDb = new Database(":memory:");

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
      CREATE TABLE ai_agent_assignments (
        scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        role TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (scope_type, scope_id)
      );
      CREATE TABLE ai_agent_rule_state (
        agent_id TEXT, rule_id TEXT, enabled INTEGER, priority_override INTEGER,
        updated_at TEXT, PRIMARY KEY (agent_id, rule_id)
      );
      CREATE TABLE ai_agent_skill_state (
        agent_id TEXT, skill_id TEXT, enabled INTEGER, last_used_at TEXT,
        updated_at TEXT, PRIMARY KEY (agent_id, skill_id)
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
      CREATE TABLE ai_workflow_runs (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, status TEXT NOT NULL,
        trigger_input TEXT, state_json TEXT NOT NULL DEFAULT '{}',
        awaiting_node_id TEXT, card_id TEXT, result_json TEXT, error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_workflow_comments (
        id TEXT PRIMARY KEY, workflow_id TEXT, card_id TEXT, author TEXT, body TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE ai_prompt_queue (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, priority INTEGER NOT NULL,
        workflow_id TEXT, adapter_ids_json TEXT, prompt TEXT, context_json TEXT,
        result_json TEXT, error TEXT, tenant_id TEXT, created_at TEXT DEFAULT (datetime('now')),
        started_at TEXT, finished_at TEXT
      );
    `);

    mocks.coreDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE hooks (
        id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
        owner_tenant_id TEXT, name TEXT NOT NULL, enabled INTEGER NOT NULL,
        trigger_kind TEXT NOT NULL, event_type TEXT, schedule_cron TEXT,
        condition_json TEXT, action_kind TEXT NOT NULL, action_config_json TEXT,
        rate_limit_per_hour INTEGER, require_approval INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')), last_fired_at TEXT
      );
      CREATE TABLE hook_runs (
        id TEXT PRIMARY KEY, hook_id TEXT NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
        event_id TEXT, status TEXT NOT NULL, detail TEXT, result_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.prepare(
      `INSERT INTO ai_agents
       (id, name, description, icon, backend, enabled, is_template, system_prompt,
        sampling_json, thinking_json, tool_allow_json, auto_approve_json, model_path,
        adapter_ids_json, config_json, parent_id, team)
       VALUES ('source', 'Source', 'private profile', 'bot', 'provider', 1, 0,
        'secret system prompt', '{}', '{}', '["read"]', '[]', NULL, '[]',
        '{"provider":"openai","reflection":{"enabled":false}}', NULL, 'Ops')`
    ).run();
  });

  it("clones, assigns, and queues reflection without exposing agent internals", async () => {
    const cloned = await agentServiceAdapter.actions!.clone(
      db,
      def("Agent"),
      "source",
      { id: "clone", name: "Clone" },
      ctx
    );
    expect(cloned).toMatchObject({
      id: "clone",
      data: { name: "Clone", backend: "provider", team: "Ops" },
    });
    expect(JSON.stringify(cloned)).not.toContain("secret system prompt");
    expect(JSON.stringify(cloned)).not.toContain('"provider":"openai"');

    const assignment = await agentServiceAdapter.actions!.assign(
      db,
      def("Agent"),
      "clone",
      { scope_type: "page", scope_id: "ops/main/dashboard", role: "editor" },
      ctx
    );
    expect(assignment).toMatchObject({
      agent_id: "clone",
      role: "editor",
    });

    await agentServiceAdapter.actions!.configure_reflection(
      db,
      def("Agent"),
      "clone",
      { enabled: true, schedule: { enabled: true } },
      ctx
    );
    const reflection = JSON.parse(
      (
        db.prepare(`SELECT config_json FROM ai_agents WHERE id = 'clone'`).get() as {
          config_json: string;
        }
      ).config_json
    ).reflection;
    expect(reflection).toMatchObject({
      enabled: true,
      schedule: { enabled: true, cron: "0 2 * * *" },
    });

    const queued = await agentServiceAdapter.actions!.run_reflection(
      db,
      def("Agent"),
      "clone",
      {},
      ctx
    );
    expect(queued).toMatchObject({ ok: true, jobId: expect.any(String) });
    expect(
      JSON.parse(
        (
          db.prepare(`SELECT context_json FROM ai_prompt_queue`).get() as {
            context_json: string;
          }
        ).context_json
      )
    ).toMatchObject({
      reflectionAgentId: "clone",
      reflectionTrigger: "manual",
    });
  });

  it("queues workflow run/resume, cancels safely, and deletes dependents", async () => {
    db.prepare(
      `INSERT INTO ai_workflows (id, agent_id, name, config_json, enabled)
       VALUES ('wf', 'source', 'Workflow', '{"nodes":[],"edges":[]}', 1)`
    ).run();
    db.prepare(
      `INSERT INTO ai_workflow_runs (id, workflow_id, status, card_id)
       VALUES ('run', 'wf', 'awaiting_input', NULL)`
    ).run();
    db.prepare(
      `INSERT INTO ai_schedules (id, workflow_id, cron_expr, timezone, enabled)
       VALUES ('schedule', 'wf', '0 9 * * *', 'UTC', 1)`
    ).run();
    mocks.coreDb.prepare(
      `INSERT INTO hooks
       (id, owner_kind, owner_id, owner_tenant_id, name, enabled, trigger_kind,
        action_kind, action_config_json, require_approval)
       VALUES ('wf-hook', 'user', ?, ?, 'Run wf', 1, 'event',
        'run_workflow', '{"workflowId":"wf"}', 0)`
    ).run(ctx.userId, ctx.tenantId);

    await workflowServiceAdapter.actions!.run(
      db,
      def("Workflow"),
      "wf",
      { trigger_input: "go" },
      ctx
    );
    await workflowRunServiceAdapter.actions!.resume(
      db,
      def("WorkflowRun"),
      "run",
      { decision: "approve" },
      ctx
    );
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM ai_prompt_queue`).get()
    ).toEqual({ c: 2 });

    await workflowRunServiceAdapter.actions!.cancel(
      db,
      def("WorkflowRun"),
      "run",
      {},
      ctx
    );
    expect(
      db.prepare(`SELECT status, error FROM ai_workflow_runs WHERE id = 'run'`).get()
    ).toEqual({ status: "failed", error: "cancelled" });

    workflowServiceAdapter.delete!(db, def("Workflow"), "wf", ctx);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM ai_workflows`).get()).toEqual({
      c: 0,
    });
    expect(db.prepare(`SELECT COUNT(*) AS c FROM ai_schedules`).get()).toEqual({
      c: 0,
    });
    expect(
      mocks.coreDb.prepare(`SELECT COUNT(*) AS c FROM hooks`).get()
    ).toEqual({ c: 0 });
  });

  it("toggles schedules and refreshes hook scheduling after every mutation", async () => {
    db.prepare(
      `INSERT INTO ai_workflows (id, name, config_json, enabled)
       VALUES ('wf', 'Workflow', '{"nodes":[],"edges":[]}', 1)`
    ).run();
    db.prepare(
      `INSERT INTO ai_schedules (id, workflow_id, cron_expr, timezone, enabled)
       VALUES ('schedule', 'wf', '0 9 * * *', 'UTC', 0)`
    ).run();

    const enabled = await scheduleServiceAdapter.actions!.enable(
      db,
      def("Schedule"),
      "schedule",
      {},
      ctx
    );
    expect(enabled).toMatchObject({ data: { enabled: true } });
    const disabled = await scheduleServiceAdapter.actions!.disable(
      db,
      def("Schedule"),
      "schedule",
      {},
      ctx
    );
    expect(disabled).toMatchObject({ data: { enabled: false } });

    const hook = hookServiceAdapter.create!(
      db,
      def("Hook"),
      {
        owner_kind: "user",
        owner_id: ctx.userId,
        name: "Daily",
        trigger_kind: "schedule",
        schedule_cron: "0 8 * * *",
        action_kind: "notify",
        action_config_json: {
          message: "Safe",
          authorization: "Bearer private",
        },
      },
      ctx
    );
    expect(hook.data.action_config_json).toEqual({
      message: "Safe",
      authorization: "[REDACTED]",
    });
    await hookServiceAdapter.actions!.disable(
      db,
      def("Hook"),
      hook.id,
      {},
      ctx
    );
    hookServiceAdapter.delete!(db, def("Hook"), hook.id, ctx);
    expect(mocks.refreshScheduler).toHaveBeenCalledTimes(3);
  });

  it("enforces hook ownership before approving or rejecting runs", async () => {
    mocks.coreDb.prepare(
      `INSERT INTO hooks
       (id, owner_kind, owner_id, owner_tenant_id, name, enabled, trigger_kind,
        action_kind, require_approval)
       VALUES ('owned', 'user', ?, ?, 'Owned', 1, 'event', 'notify', 1),
              ('other', 'user', 'other-user', ?, 'Other', 1, 'event', 'notify', 1)`
    ).run(ctx.userId, ctx.tenantId, ctx.tenantId);
    mocks.coreDb.prepare(
      `INSERT INTO hook_runs (id, hook_id, status)
       VALUES ('approve-run', 'owned', 'pending_approval'),
              ('reject-run', 'owned', 'pending_approval'),
              ('other-run', 'other', 'pending_approval')`
    ).run();

    await hookRunServiceAdapter.actions!.approve(
      db,
      def("HookRun"),
      "approve-run",
      {},
      ctx
    );
    await hookRunServiceAdapter.actions!.reject(
      db,
      def("HookRun"),
      "reject-run",
      {},
      ctx
    );
    expect(mocks.approveHookRun).toHaveBeenCalledWith(
      "approve-run",
      mocks.coreDb
    );
    expect(mocks.rejectHookRun).toHaveBeenCalledWith(
      "reject-run",
      mocks.coreDb
    );
    await expect(
      hookRunServiceAdapter.actions!.approve(
        db,
        def("HookRun"),
        "other-run",
        {},
        ctx
      )
    ).rejects.toMatchObject({ status: 403 });
  });
});
