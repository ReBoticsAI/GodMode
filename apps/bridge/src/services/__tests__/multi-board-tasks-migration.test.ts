import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { columnExists } from "../db-migrations.js";
import { TENANT_BOOT_MIGRATIONS } from "../../db.js";

describe("multi_board_tasks_github_v1 migration", () => {
  it("adds board archive/GitHub columns even when v9 already applied", () => {
    const migration = TENANT_BOOT_MIGRATIONS.find(
      (m) => m.version === 14 && m.name === "multi_board_tasks_github_v1"
    );
    expect(migration).toBeTruthy();

    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ai_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        user_id TEXT,
        agent_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    expect(columnExists(db, "ai_projects", "archived_at")).toBe(false);
    migration!.up(db);
    expect(columnExists(db, "ai_projects", "archived_at")).toBe(true);
    expect(columnExists(db, "ai_projects", "github_project_node_id")).toBe(true);
    expect(columnExists(db, "ai_projects", "sync_enabled")).toBe(true);
    migration!.up(db); // idempotent
    db.close();
  });
});
