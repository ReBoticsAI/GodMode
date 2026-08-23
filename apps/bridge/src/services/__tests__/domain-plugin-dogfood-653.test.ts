import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import { CATALOG_CHANGING_TOOL_NAMES } from "../agents/cursor-cloud-backend.js";
import { getAgent } from "../agents/agents-db.js";
import { stripIntelligenceToolsAfterPluginUninstall } from "../knowledge-store.js";
import { writeTenantKind } from "../tenant-kind.js";
import { deleteCodingRootPluginSource } from "../plugin-lifecycle.js";

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

describe("catalog changing tools (#653)", () => {
  it("treats install/scaffold/build plugin as catalog mutations", () => {
    expect(CATALOG_CHANGING_TOOL_NAMES.has("install_plugin")).toBe(true);
    expect(CATALOG_CHANGING_TOOL_NAMES.has("scaffold_plugin")).toBe(true);
    expect(CATALOG_CHANGING_TOOL_NAMES.has("build_plugin")).toBe(true);
    expect(CATALOG_CHANGING_TOOL_NAMES.has("read_file")).toBe(false);
  });
});

describe("stripIntelligenceToolsAfterPluginUninstall (#653)", () => {
  it("removes plugin tool names from personal Intelligence toolAllow", () => {
    const db = openPersonalDb([
      "read_file",
      "gift_ideas_add",
      "gift_ideas_list",
      "write_file",
    ]);
    stripIntelligenceToolsAfterPluginUninstall(db, [
      "gift_ideas_add",
      "gift_ideas_list",
    ]);
    expect(getAgent(db, "intelligence")?.toolAllow).toEqual([
      "read_file",
      "write_file",
    ]);
  });
});

describe("deleteCodingRootPluginSource (#653)", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("deletes plugins/<id> when the install root is under the coding root", () => {
    const codingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gm-coding-"));
    tmpRoots.push(codingRoot);
    const pluginId = "gift-ideas";
    const pluginRoot = path.join(codingRoot, "plugins", pluginId);
    fs.mkdirSync(path.join(pluginRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "src", "bridge.ts"), "export {};\n");

    const result = deleteCodingRootPluginSource({
      tenantId: "tenant-test",
      pluginId,
      pluginRoot,
      codingRootOverride: codingRoot,
    });
    expect(result.deleted).toBe(true);
    expect(fs.existsSync(pluginRoot)).toBe(false);
  });

  it("leaves trees outside the coding-root plugins/<id> path alone", () => {
    const codingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gm-coding-"));
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), "gm-foreign-"));
    tmpRoots.push(codingRoot, foreign);
    const pluginId = "gift-ideas";
    const pluginRoot = path.join(foreign, pluginId);
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, "keep.txt"), "x");

    const result = deleteCodingRootPluginSource({
      tenantId: "tenant-test",
      pluginId,
      pluginRoot,
      codingRootOverride: codingRoot,
    });
    expect(result.deleted).toBe(false);
    expect(fs.existsSync(path.join(pluginRoot, "keep.txt"))).toBe(true);
  });
});
