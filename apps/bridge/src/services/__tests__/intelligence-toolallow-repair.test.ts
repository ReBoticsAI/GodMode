/**
 * Intelligence toolAllow merges newly registered registry tools (#442).
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import { getAgent } from "../agents/agents-db.js";
import {
  getToolSchemasForLlm,
  isToolVisibleForAgent,
  personalIntelligenceToolNames,
} from "../ai-tools-registry.js";
import {
  mergeIntelligenceToolAllowWithRegistry,
  refreshIntelligenceToolsAfterPluginInstall,
  repairPersonalTenantDefaults,
} from "../knowledge-store.js";
import { writeTenantKind } from "../tenant-kind.js";
import { pluginToolNamesForPlugin } from "../../plugins/plugin-tools.js";

function openPersonalDb(toolAllow: string[] | null): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(`
    CREATE TABLE ai_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE ai_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      backend TEXT NOT NULL DEFAULT 'provider',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_template INTEGER NOT NULL DEFAULT 0,
      system_prompt TEXT NOT NULL DEFAULT '',
      sampling_json TEXT NOT NULL DEFAULT '{}',
      thinking_json TEXT NOT NULL DEFAULT '{}',
      tool_allow_json TEXT,
      auto_approve_json TEXT,
      model_path TEXT,
      adapter_ids_json TEXT,
      config_json TEXT,
      parent_id TEXT,
      team TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_rules (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'intelligence',
      description TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
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
      body TEXT NOT NULL DEFAULT '',
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
      PRIMARY KEY (agent_id, rule_id)
    );
    CREATE TABLE ai_agent_skill_state (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    );
  `);
  writeTenantKind(db, "personal");
  db.prepare(
    `INSERT INTO ai_agents (
       id, name, backend, enabled, is_template, system_prompt,
       sampling_json, thinking_json, tool_allow_json
     ) VALUES (?, ?, 'provider', 1, 0, '', '{}', '{}', ?)`
  ).run(
    "intelligence",
    "Intelligence",
    toolAllow === null ? null : JSON.stringify(toolAllow)
  );
  return db;
}

describe("Intelligence toolAllow registry sync (#442)", () => {
  it("mergeIntelligenceToolAllowWithRegistry adds missing registry tools", () => {
    const merged = mergeIntelligenceToolAllowWithRegistry([
      "git_status",
      "git_push",
      "remember",
    ]);
    expect(merged).toContain("git_clone");
    expect(merged).toContain("github_repo_create");
    expect(merged).toContain("github_pr_create");
    expect(merged).toContain("github_release_create");
    expect(merged).toContain("promote_support_to_card");
    expect(merged).toContain("git_push");
    expect(merged).toContain("remember");
  });

  it("repair merges git_clone and github_pr_create into a stale snapshot", () => {
    const stale = [
      "remember",
      "git_status",
      "git_diff",
      "git_branch",
      "git_checkout",
      "git_add",
      "git_commit",
      "git_push",
    ];
    const db = openPersonalDb(stale);
    expect(getAgent(db, "intelligence")?.toolAllow).not.toContain("git_clone");

    repairPersonalTenantDefaults(db);

    const allow = getAgent(db, "intelligence")?.toolAllow ?? [];
    expect(allow).toContain("git_clone");
    expect(allow).toContain("github_repo_create");
    expect(allow).toContain("github_pr_create");
    expect(allow).toContain("github_release_create");
    expect(allow).toContain("git_push");
    for (const name of stale) expect(allow).toContain(name);
  });

  it("repair leaves explicit empty lockdown alone", () => {
    const db = openPersonalDb([]);
    repairPersonalTenantDefaults(db);
    expect(getAgent(db, "intelligence")?.toolAllow).toEqual([]);
  });

  it("repair seeds full defaults when toolAllow is null", () => {
    const db = openPersonalDb(null);
    repairPersonalTenantDefaults(db);
    const allow = getAgent(db, "intelligence")?.toolAllow ?? [];
    const defaults = personalIntelligenceToolNames();
    expect(allow.sort()).toEqual([...defaults].sort());
    expect(allow).toContain("git_clone");
    expect(allow).toContain("github_repo_create");
    expect(allow).toContain("github_pr_create");
  });

  it("refreshIntelligenceToolsAfterPluginInstall merges stale allow so schemas can include new tools (#645)", () => {
    const stale = [
      "remember",
      "git_status",
      "install_plugin",
      "list_structure",
    ];
    const db = openPersonalDb(stale);
    expect(isToolVisibleForAgent(db, "intelligence", "git_clone")).toBe(false);

    refreshIntelligenceToolsAfterPluginInstall(db);

    expect(isToolVisibleForAgent(db, "intelligence", "git_clone")).toBe(true);
    const schemas = getToolSchemasForLlm(db, "intelligence", "agent");
    expect(schemas.some((s) => s.function.name === "git_clone")).toBe(true);
    expect(pluginToolNamesForPlugin("missing-plugin")).toEqual([]);
  });
});
