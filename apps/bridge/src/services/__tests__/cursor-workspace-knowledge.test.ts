/**
 * Workspace AGENTS.md + .cursor/ Knowledge import for local backends (#71).
 */
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import {
  CURSOR_WORKSPACE_SOURCE,
  CURSOR_WS_AGENTS_MD_ID,
  CURSOR_WS_DOT_CURSOR_AGENTS_MD_ID,
  clearCursorWorkspaceSyncCacheForTests,
  importCursorWorkspaceKnowledge,
  syncCursorWorkspaceKnowledge,
} from "../knowledge-store.js";

const temps: string[] = [];

afterEach(() => {
  clearCursorWorkspaceSyncCacheForTests();
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "gm-cursor-know-"));
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_agent_rule_state (
      agent_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, rule_id)
    );
    CREATE TABLE ai_agent_skill_state (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    );
  `);
  return db;
}

describe("importCursorWorkspaceKnowledge", () => {
  it("imports nested .mdc rules and skills with prefixed ids", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".cursor", "rules", "nested"), { recursive: true });
    mkdirSync(join(root, ".cursor", "skills", "demo-skill"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "rules", "be-terse.mdc"),
      "---\ndescription: Be terse\nalwaysApply: true\n---\nBe terse.\n",
      "utf8"
    );
    writeFileSync(
      join(root, ".cursor", "rules", "nested", "extra.mdc"),
      "---\ndescription: Nested\n---\nNested rule.\n",
      "utf8"
    );
    writeFileSync(
      join(root, ".cursor", "skills", "demo-skill", "SKILL.md"),
      "---\nname: Demo\ndescription: Demo skill\n---\nDo the demo.\n",
      "utf8"
    );

    const db = openDb();
    const result = importCursorWorkspaceKnowledge(db, root);
    expect(result.rules).toBe(2);
    expect(result.skills).toBe(1);

    const rules = db
      .prepare(
        `SELECT id, description, source_plugin_id FROM ai_rules WHERE source_plugin_id = ?`
      )
      .all(CURSOR_WORKSPACE_SOURCE) as Array<{
      id: string;
      description: string;
      source_plugin_id: string;
    }>;
    expect(rules.map((r) => r.id).sort()).toEqual([
      "cursor-ws-be-terse",
      "cursor-ws-nested--extra",
    ]);
    expect(rules.every((r) => r.source_plugin_id === CURSOR_WORKSPACE_SOURCE)).toBe(
      true
    );

    const skills = db
      .prepare(`SELECT id, name FROM ai_skills WHERE source_plugin_id = ?`)
      .all(CURSOR_WORKSPACE_SOURCE) as Array<{ id: string; name: string }>;
    expect(skills).toEqual([{ id: "cursor-ws-skill-demo-skill", name: "Demo" }]);
  });

  it("imports root and .cursor AGENTS.md as always-apply rules", () => {
    const root = tempRoot();
    writeFileSync(join(root, "AGENTS.md"), "Prefer small PRs.\n", "utf8");
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "AGENTS.md"),
      "Use workspace tools carefully.\n",
      "utf8"
    );

    const db = openDb();
    const result = importCursorWorkspaceKnowledge(db, root);
    expect(result.rules).toBe(2);
    expect(result.skills).toBe(0);

    const rules = db
      .prepare(
        `SELECT id, description, body, always_apply FROM ai_rules WHERE source_plugin_id = ? ORDER BY id`
      )
      .all(CURSOR_WORKSPACE_SOURCE) as Array<{
      id: string;
      description: string;
      body: string;
      always_apply: number;
    }>;
    expect(rules.map((r) => r.id)).toEqual([
      CURSOR_WS_AGENTS_MD_ID,
      CURSOR_WS_DOT_CURSOR_AGENTS_MD_ID,
    ]);
    expect(rules.every((r) => r.always_apply === 1)).toBe(true);
    expect(rules[0]!.body).toContain("Prefer small PRs");
    expect(rules[1]!.body).toContain("Use workspace tools carefully");
  });

  it("syncs when only root AGENTS.md exists (no .cursor)", () => {
    const root = tempRoot();
    writeFileSync(join(root, "AGENTS.md"), "Agents instructions.\n", "utf8");
    const db = openDb();
    const first = syncCursorWorkspaceKnowledge(db, root);
    expect(first.synced).toBe(true);
    expect(first.rules).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT id FROM ai_rules WHERE id = ?`)
          .get(CURSOR_WS_AGENTS_MD_ID) as { id: string } | undefined
      )?.id
    ).toBe(CURSOR_WS_AGENTS_MD_ID);

    const second = syncCursorWorkspaceKnowledge(db, root);
    expect(second.synced).toBe(false);

    writeFileSync(join(root, "AGENTS.md"), "Updated agents instructions.\n", "utf8");
    const third = syncCursorWorkspaceKnowledge(db, root);
    expect(third.synced).toBe(true);
    expect(
      (
        db
          .prepare(`SELECT body FROM ai_rules WHERE id = ?`)
          .get(CURSOR_WS_AGENTS_MD_ID) as { body: string }
      ).body
    ).toContain("Updated agents");
  });

  it("syncs only when fingerprint changes", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "rules", "a.mdc"),
      "---\ndescription: A\n---\nA\n",
      "utf8"
    );
    const db = openDb();
    const first = syncCursorWorkspaceKnowledge(db, root);
    expect(first.synced).toBe(true);
    expect(first.rules).toBe(1);

    const second = syncCursorWorkspaceKnowledge(db, root);
    expect(second.synced).toBe(false);
    expect(second.rules).toBe(0);

    writeFileSync(
      join(root, ".cursor", "rules", "b.mdc"),
      "---\ndescription: B\n---\nB\n",
      "utf8"
    );
    const third = syncCursorWorkspaceKnowledge(db, root);
    expect(third.synced).toBe(true);
    expect(third.rules).toBe(2);
  });

  it("clears imported rows when .cursor disappears", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".cursor", "rules"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "rules", "a.mdc"),
      "---\ndescription: A\n---\nA\n",
      "utf8"
    );
    const db = openDb();
    syncCursorWorkspaceKnowledge(db, root);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM ai_rules WHERE source_plugin_id = ?`
          )
          .get(CURSOR_WORKSPACE_SOURCE) as { c: number }
      ).c
    ).toBe(1);

    rmSync(join(root, ".cursor"), { recursive: true, force: true });
    clearCursorWorkspaceSyncCacheForTests();
    const cleared = syncCursorWorkspaceKnowledge(db, root);
    expect(cleared.synced).toBe(true);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM ai_rules WHERE source_plugin_id = ?`
          )
          .get(CURSOR_WORKSPACE_SOURCE) as { c: number }
      ).c
    ).toBe(0);
  });
});
