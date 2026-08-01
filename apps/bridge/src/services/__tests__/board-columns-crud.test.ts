import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  columnsForBoard,
  createUserBoard,
  ensureUserProject,
  parseBoardColumns,
  updateBoardColumns,
  visibleColumnsForBoard,
  type UserBoardRow,
} from "../user-productivity.js";
import { migrateTenantDb } from "../../db.js";

function openMigratedDb(): Database.Database {
  const db = new Database(":memory:");
  migrateTenantDb(db);
  return db;
}

describe("board columns CRUD", () => {
  it("parses hidden and wip_limit", () => {
    const cols = parseBoardColumns(
      JSON.stringify([
        { id: "a", name: "A", sort_order: 0, hidden: true, wip_limit: 3 },
        { id: "b", name: "B", sort_order: 1 },
      ])
    );
    expect(cols[0]).toMatchObject({
      id: "a",
      hidden: true,
      wip_limit: 3,
    });
    expect(cols[1].hidden).toBe(false);
    expect(cols[1].wip_limit).toBeNull();
  });

  it("updates columns, remaps cards, and hides from visible list", () => {
    const db = openMigratedDb();
    const userId = "user-cols";
    ensureUserProject(userId, db);
    const board = createUserBoard(userId, db, "Custom");
    db.prepare(
      `INSERT INTO ai_project_cards (id, project_id, column_id, title, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    ).run("c1", board.id, "backlog", "One", 0);
    db.prepare(
      `INSERT INTO ai_project_cards (id, project_id, column_id, title, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    ).run("c2", board.id, "ready", "Two", 0);

    const updated = updateBoardColumns(userId, db, board.id, [
      { id: "triage", name: "Triage", sort_order: 0, wip_limit: 2 },
      { id: "doing", name: "Doing", sort_order: 1, hidden: false },
      { id: "parked", name: "Parked", sort_order: 2, hidden: true },
    ]);

    const cols = columnsForBoard(updated);
    expect(cols.map((c) => c.id)).toEqual(["triage", "doing", "parked"]);
    expect(visibleColumnsForBoard(updated).map((c) => c.id)).toEqual([
      "triage",
      "doing",
    ]);
    expect(cols[0]!.wip_limit).toBe(2);

    const cards = db
      .prepare(`SELECT id, column_id FROM ai_project_cards WHERE project_id=?`)
      .all(board.id) as Array<{ id: string; column_id: string }>;
    expect(cards.every((c) => c.column_id === "triage")).toBe(true);

    const row = db
      .prepare(`SELECT * FROM ai_projects WHERE id=?`)
      .get(board.id) as UserBoardRow;
    expect(visibleColumnsForBoard(row)).toHaveLength(2);
    db.close();
  });
});
