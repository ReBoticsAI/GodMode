/**
 * Host Cursor user ~/.cursor Rules/Skills Knowledge import (#202).
 */
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import {
  CURSOR_USER_SOURCE,
  clearCursorUserSyncCacheForTests,
  importCursorUserKnowledge,
  syncCursorUserKnowledge,
} from "../knowledge-store.js";

const temps: string[] = [];

afterEach(() => {
  clearCursorUserSyncCacheForTests();
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempCursorHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-cursor-user-"));
  temps.push(dir);
  return dir;
}

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE ai_rules (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'intelligence',
      description TEXT NOT NULL,
      body TEXT NOT NULL,
      always_apply INTEGER NOT NULL DEFAULT 1,
      globs_json TEXT NOT NULL DEFAULT '[]',
      departments_json TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 50,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      source_plugin_id TEXT,
      content_hash TEXT,
      user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_skills (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'intelligence',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      tools_json TEXT NOT NULL DEFAULT '[]',
      departments_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      source_plugin_id TEXT,
      content_hash TEXT,
      user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_agent_rule_state (
      agent_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority_override INTEGER,
      status TEXT,
      PRIMARY KEY (agent_id, rule_id)
    );
    CREATE TABLE ai_agent_skill_state (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT,
      PRIMARY KEY (agent_id, skill_id)
    );
  `);
  return db;
}

describe("importCursorUserKnowledge", () => {
  it("imports nested .mdc rules and skills with cursor-user ids", () => {
    const home = tempCursorHome();
    mkdirSync(join(home, "rules", "nested"), { recursive: true });
    mkdirSync(join(home, "skills", "demo-skill"), { recursive: true });
    writeFileSync(
      join(home, "rules", "no-em-dashes.mdc"),
      "---\ndescription: No em-dashes\nalwaysApply: true\n---\nBan em-dashes.\n",
      "utf8"
    );
    writeFileSync(
      join(home, "rules", "nested", "extra.mdc"),
      "---\ndescription: Nested\n---\nNested user rule.\n",
      "utf8"
    );
    writeFileSync(
      join(home, "skills", "demo-skill", "SKILL.md"),
      "---\nname: Demo\ndescription: Demo skill\n---\nDo the demo.\n",
      "utf8"
    );

    const db = openDb();
    const result = importCursorUserKnowledge(db, home);
    expect(result.rules).toBe(2);
    expect(result.skills).toBe(1);
    expect(result.sourceDir).toBe(home);

    const rules = db
      .prepare(
        `SELECT id, source_plugin_id FROM ai_rules WHERE source_plugin_id = ?`
      )
      .all(CURSOR_USER_SOURCE) as Array<{ id: string; source_plugin_id: string }>;
    expect(rules.map((r) => r.id).sort()).toEqual([
      "cursor-user-nested--extra",
      "cursor-user-no-em-dashes",
    ]);
    expect(rules.every((r) => r.source_plugin_id === CURSOR_USER_SOURCE)).toBe(
      true
    );

    const skills = db
      .prepare(`SELECT id, name FROM ai_skills WHERE source_plugin_id = ?`)
      .all(CURSOR_USER_SOURCE) as Array<{ id: string; name: string }>;
    expect(skills).toEqual([
      { id: "cursor-user-skill-demo-skill", name: "Demo" },
    ]);
  });

  it("does not import skills-cursor (only ~/.cursor/skills)", () => {
    const home = tempCursorHome();
    mkdirSync(join(home, "skills-cursor", "canvas"), { recursive: true });
    writeFileSync(
      join(home, "skills-cursor", "canvas", "SKILL.md"),
      "---\nname: Canvas\n---\nProduct skill.\n",
      "utf8"
    );
    const db = openDb();
    const result = importCursorUserKnowledge(db, home);
    expect(result.rules).toBe(0);
    expect(result.skills).toBe(0);
  });

  it("syncs only when fingerprint changes", () => {
    const home = tempCursorHome();
    mkdirSync(join(home, "rules"), { recursive: true });
    writeFileSync(
      join(home, "rules", "a.mdc"),
      "---\ndescription: A\n---\nA\n",
      "utf8"
    );
    const db = openDb();
    const first = syncCursorUserKnowledge(db, { cursorHome: home });
    expect(first.synced).toBe(true);
    expect(first.rules).toBe(1);

    const second = syncCursorUserKnowledge(db, { cursorHome: home });
    expect(second.synced).toBe(false);

    writeFileSync(
      join(home, "rules", "b.mdc"),
      "---\ndescription: B\n---\nB\n",
      "utf8"
    );
    const third = syncCursorUserKnowledge(db, { cursorHome: home });
    expect(third.synced).toBe(true);
    expect(third.rules).toBe(2);
  });

  it("clears imported rows when rules disappear", () => {
    const home = tempCursorHome();
    mkdirSync(join(home, "rules"), { recursive: true });
    writeFileSync(
      join(home, "rules", "a.mdc"),
      "---\ndescription: A\n---\nA\n",
      "utf8"
    );
    const db = openDb();
    syncCursorUserKnowledge(db, { cursorHome: home });
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM ai_rules WHERE source_plugin_id = ?`
          )
          .get(CURSOR_USER_SOURCE) as { c: number }
      ).c
    ).toBe(1);

    rmSync(join(home, "rules"), { recursive: true, force: true });
    clearCursorUserSyncCacheForTests();
    const cleared = syncCursorUserKnowledge(db, { cursorHome: home });
    expect(cleared.synced).toBe(true);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM ai_rules WHERE source_plugin_id = ?`
          )
          .get(CURSOR_USER_SOURCE) as { c: number }
      ).c
    ).toBe(0);
  });

  it("does not overwrite user-edited Cursor user rules", () => {
    const home = tempCursorHome();
    mkdirSync(join(home, "rules"), { recursive: true });
    writeFileSync(
      join(home, "rules", "a.mdc"),
      "---\ndescription: A\n---\nOriginal\n",
      "utf8"
    );
    const db = openDb();
    syncCursorUserKnowledge(db, { cursorHome: home });
    db.prepare(
      `UPDATE ai_rules SET body = ?, user_edited = 1 WHERE id = ?`
    ).run("Edited in GodMode", "cursor-user-a");

    writeFileSync(
      join(home, "rules", "a.mdc"),
      "---\ndescription: A\n---\nDisk changed\n",
      "utf8"
    );
    clearCursorUserSyncCacheForTests();
    syncCursorUserKnowledge(db, { force: true, cursorHome: home });

    const row = db
      .prepare(`SELECT body, user_edited FROM ai_rules WHERE id = ?`)
      .get("cursor-user-a") as { body: string; user_edited: number };
    expect(row.body).toBe("Edited in GodMode");
    expect(row.user_edited).toBe(1);
  });

  it("lists imported rules as enabled without agent_rule_state rows", () => {
    const home = tempCursorHome();
    mkdirSync(join(home, "rules"), { recursive: true });
    writeFileSync(
      join(home, "rules", "live.mdc"),
      "---\ndescription: Live\nalwaysApply: true\n---\nStay live.\n",
      "utf8"
    );
    const db = openDb();
    importCursorUserKnowledge(db, home);
    const row = db
      .prepare(
        `SELECT r.enabled AS enabled, s.enabled AS st_enabled
         FROM ai_rules r
         LEFT JOIN ai_agent_rule_state s
           ON s.rule_id = r.id AND s.agent_id = 'intelligence'
         WHERE r.id = ?`
      )
      .get("cursor-user-live") as {
      enabled: number;
      st_enabled: number | null;
    };
    // Mirrors listRulesFromDb: LEFT JOIN null must not force disabled.
    const enabled =
      row.st_enabled != null
        ? Number(row.st_enabled) !== 0
        : Boolean(row.enabled);
    expect(row.st_enabled).toBeNull();
    expect(enabled).toBe(true);
  });
});
