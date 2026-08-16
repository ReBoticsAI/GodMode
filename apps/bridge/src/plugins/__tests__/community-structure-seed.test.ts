import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  applyCommunityStructureInsert,
  parseCommunityStructureInsert,
} from "../community-structure-seed.js";

const PULSE_DEPT = `INSERT OR IGNORE INTO structure_nodes
         (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
       VALUES (?, NULL, ?, 'activity', ?, 'placeholder', NULL, NULL, 0, 40, NULL)`;

const PULSE_DIVISION = `INSERT OR IGNORE INTO structure_nodes
         (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
       VALUES (?, ?, ?, 'heart-pulse', ?, 'placeholder', NULL, NULL, 0, 0, NULL)`;

describe("Community structure seed SQL (#562)", () => {
  it("parses the Workspace Pulse department insert", () => {
    const parsed = parseCommunityStructureInsert(PULSE_DEPT, [
      "workspace-pulse",
      "Workspace Pulse",
      "workspace-pulse",
    ]);
    expect(parsed.columns).toContain("id");
    expect(parsed.values[parsed.columns.indexOf("id")]).toBe("workspace-pulse");
    expect(parsed.values[parsed.columns.indexOf("parent_id")]).toBeNull();
    expect(parsed.values[parsed.columns.indexOf("icon")]).toBe("activity");
    expect(parsed.values[parsed.columns.indexOf("sort_order")]).toBe(40);
  });

  it("rejects live-query and other-table SQL", () => {
    expect(() =>
      parseCommunityStructureInsert("SELECT * FROM structure_nodes", [])
    ).toThrow(/structure_nodes/i);
    expect(() =>
      parseCommunityStructureInsert(
        "INSERT OR IGNORE INTO users (id) VALUES (?)",
        ["x"]
      )
    ).toThrow(/structure_nodes/i);
    expect(() =>
      parseCommunityStructureInsert(
        "INSERT INTO structure_nodes (id, label, icon, segment) VALUES (?, ?, ?, ?)",
        ["a", "A", "folder", "a"]
      )
    ).toThrow(/INSERT OR IGNORE/i);
  });

  it("applies INSERT OR IGNORE onto a tenant structure_nodes table", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE structure_nodes (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        label TEXT NOT NULL,
        icon TEXT NOT NULL,
        segment TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'placeholder',
        object_type TEXT,
        right_sidebar TEXT,
        agent_id TEXT,
        built_in INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        tabs_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    applyCommunityStructureInsert(db as never, PULSE_DEPT, [
      "workspace-pulse",
      "Workspace Pulse",
      "workspace-pulse",
    ]);
    applyCommunityStructureInsert(db as never, PULSE_DIVISION, [
      "workspace-pulse-health",
      "workspace-pulse",
      "Health",
      "health",
    ]);
    const second = applyCommunityStructureInsert(db as never, PULSE_DEPT, [
      "workspace-pulse",
      "Workspace Pulse",
      "workspace-pulse",
    ]);
    expect(second.ignored).toBe(true);
    const rows = db
      .prepare("SELECT id, parent_id, label FROM structure_nodes ORDER BY id")
      .all() as Array<{ id: string; parent_id: string | null; label: string }>;
    expect(rows).toEqual([
      { id: "workspace-pulse", parent_id: null, label: "Workspace Pulse" },
      {
        id: "workspace-pulse-health",
        parent_id: "workspace-pulse",
        label: "Health",
      },
    ]);
    db.close();
  });
});
