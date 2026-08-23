import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { executeTool, type ToolExecContext } from "../ai-tool-executor.js";
import { AI_TOOL_REGISTRY } from "../ai-tools-registry.js";
import type { AppDatabase } from "../../db.js";

function openRunDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE ai_workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      card_id TEXT,
      awaiting_node_id TEXT,
      error TEXT,
      trigger_input TEXT,
      state_json TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function ctx(db: AppDatabase): ToolExecContext {
  return {
    db,
    tenantId: "t1",
    activeAgentId: "intelligence",
  } as ToolExecContext;
}

describe("workflow run tools (#659)", () => {
  it("registers get_workflow_run and list_workflow_runs", () => {
    expect(AI_TOOL_REGISTRY.some((t) => t.name === "get_workflow_run")).toBe(true);
    expect(AI_TOOL_REGISTRY.some((t) => t.name === "list_workflow_runs")).toBe(true);
  });

  it("get_workflow_run and list_workflow_runs read durable runs", async () => {
    const db = openRunDb();
    db.prepare(
      `INSERT INTO ai_workflow_runs (id, workflow_id, status, awaiting_node_id, error)
       VALUES (?, ?, ?, ?, ?)`
    ).run("run-1", "scaffold-domain-plugin", "running", "implement", null);
    db.prepare(
      `INSERT INTO ai_workflow_runs (id, workflow_id, status, awaiting_node_id, error)
       VALUES (?, ?, ?, ?, ?)`
    ).run("run-2", "other-wf", "done", null, null);

    const one = (await executeTool(
      "get_workflow_run",
      { runId: "run-1" },
      ctx(db)
    )) as { id: string; status: string; awaiting_node_id: string };
    expect(one.id).toBe("run-1");
    expect(one.status).toBe("running");
    expect(one.awaiting_node_id).toBe("implement");

    const listed = (await executeTool(
      "list_workflow_runs",
      { workflowId: "scaffold-domain-plugin" },
      ctx(db)
    )) as { runs: Array<{ id: string }> };
    expect(listed.runs.map((r) => r.id)).toEqual(["run-1"]);
  });
});
