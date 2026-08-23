import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { prunePluginStructureNodes } from "../structure.js";
import type { AppDatabase } from "../../db.js";

function openStructureDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE structure_nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      label TEXT NOT NULL,
      icon TEXT,
      segment TEXT,
      kind TEXT,
      built_in INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe("prunePluginStructureNodes (#658)", () => {
  it("removes plugin department root and nested children", () => {
    const db = openStructureDb();
    db.prepare(
      `INSERT INTO structure_nodes (id, parent_id, label, built_in) VALUES (?, NULL, ?, 0)`
    ).run("plant-care", "Plant Care");
    db.prepare(
      `INSERT INTO structure_nodes (id, parent_id, label, built_in) VALUES (?, ?, ?, 0)`
    ).run("plant-care-welcome", "plant-care", "Welcome");
    db.prepare(
      `INSERT INTO structure_nodes (id, parent_id, label, built_in) VALUES (?, ?, ?, 0)`
    ).run("plant-care-plants", "plant-care", "Plants");
    db.prepare(
      `INSERT INTO structure_nodes (id, parent_id, label, built_in) VALUES (?, NULL, ?, 0)`
    ).run("other-dept", "Keep Me");

    const result = prunePluginStructureNodes(db, { pluginId: "plant-care" });
    expect(result.prunedRoots).toEqual(["plant-care"]);

    const left = db
      .prepare(`SELECT id FROM structure_nodes ORDER BY id`)
      .all() as Array<{ id: string }>;
    expect(left.map((r) => r.id)).toEqual(["other-dept"]);
  });

  it("skips built_in roots and uses manifest department ids", () => {
    const db = openStructureDb();
    db.prepare(
      `INSERT INTO structure_nodes (id, parent_id, label, built_in) VALUES (?, NULL, ?, 1)`
    ).run("core-home", "Home");
    db.prepare(
      `INSERT INTO structure_nodes (id, parent_id, label, built_in) VALUES (?, NULL, ?, 0)`
    ).run("gift-ideas", "Gift Ideas");
    db.prepare(
      `INSERT INTO structure_nodes (id, parent_id, label, built_in) VALUES (?, ?, ?, 0)`
    ).run("gift-ideas-people", "gift-ideas", "People");

    const result = prunePluginStructureNodes(db, {
      pluginId: "gift-ideas",
      departmentIds: ["gift-ideas", "core-home"],
    });
    expect(result.prunedRoots).toEqual(["gift-ideas"]);
    const left = db
      .prepare(`SELECT id FROM structure_nodes ORDER BY id`)
      .all() as Array<{ id: string }>;
    expect(left.map((r) => r.id)).toEqual(["core-home"]);
  });
});
