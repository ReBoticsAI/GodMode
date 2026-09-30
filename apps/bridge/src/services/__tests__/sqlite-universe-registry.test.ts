import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../../config.js";
import {
  SQLITE_UNIVERSE_MAX_OPEN,
  closeRegistryDb,
  ensureAgentUniverseFile,
  ensureChatUniverseFile,
  ensureSurfaceUniverseFile,
  ensureUserUniverseFile,
  ensureVaultUniverseFiles,
  listUniverseManifest,
  prepareOpenSet,
  resolveUniversePath,
  sqliteUniverseRoot,
} from "../sqlite-universe-registry.js";
import {
  listSqliteUniverseTool,
  querySqliteUniverseTool,
} from "../sqlite-universe-tools.js";

describe("sqlite-universe-registry", () => {
  const prev = config.dataDir;
  let tmp: string;

  afterEach(() => {
    closeRegistryDb();
    config.dataDir = prev;
    if (tmp && fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("jails path traversal", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-universe-"));
    config.dataDir = tmp;
    expect(resolveUniversePath("../etc/passwd").ok).toBe(false);
    expect(resolveUniversePath("actors/agents/x.sqlite").ok).toBe(true);
  });

  it("prepareOpenSet creates files under root", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-universe-"));
    config.dataDir = tmp;
    const result = prepareOpenSet(["actors/agents/intelligence.sqlite"]);
    expect(result.opened).toHaveLength(1);
    expect(fs.existsSync(result.opened[0]!.absolutePath)).toBe(true);
    expect(result.opened[0]!.absolutePath.startsWith(sqliteUniverseRoot())).toBe(
      true
    );
  });

  it("rejects open sets above max", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-universe-"));
    config.dataDir = tmp;
    const paths = Array.from(
      { length: SQLITE_UNIVERSE_MAX_OPEN + 1 },
      (_, i) => `chats/c${i}.sqlite`
    );
    const result = prepareOpenSet(paths);
    expect(result.opened).toHaveLength(0);
    expect(result.rejected.length).toBe(paths.length);
  });

  it("dual-writes chat under agent child_chats", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-universe-"));
    config.dataDir = tmp;
    const chat = ensureChatUniverseFile({
      chatId: "c-test",
      ownerAgentId: "intelligence",
      label: "Test",
    });
    expect(fs.existsSync(chat.absolutePath)).toBe(true);
    const agent = ensureAgentUniverseFile({ agentId: "intelligence" });
    expect(fs.existsSync(agent.absolutePath)).toBe(true);
    const adb = new Database(agent.absolutePath, { readonly: true });
    const row = adb
      .prepare(`SELECT chat_id FROM child_chats WHERE chat_id = ?`)
      .get("c-test") as { chat_id: string } | undefined;
    adb.close();
    expect(row?.chat_id).toBe("c-test");
    const manifest = listUniverseManifest();
    expect(manifest.some((f) => f.id === "chat:c-test")).toBe(true);
    expect(manifest.some((f) => f.id === "agent:intelligence")).toBe(true);
  });

  it("folds Account/Cloud/Workspace into User Vault schema", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-universe-"));
    config.dataDir = tmp;
    const vaults = ensureVaultUniverseFiles({ userId: "u-vault" });
    expect(fs.existsSync(vaults.userVault.absolutePath)).toBe(true);
    const vdb = new Database(vaults.userVault.absolutePath, { readonly: true });
    const handles = vdb
      .prepare(`SELECT handle_kind FROM vault_handles ORDER BY handle_kind`)
      .all() as Array<{ handle_kind: string }>;
    vdb.close();
    expect(handles.map((h) => h.handle_kind)).toEqual([
      "account",
      "cloud",
      "workspace",
    ]);
  });

  it("creates surface stubs and supports read-only tools", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-universe-"));
    config.dataDir = tmp;
    ensureUserUniverseFile({ userId: "u1" });
    const surface = ensureSurfaceUniverseFile({
      kind: "structure",
      id: "default",
      ownerUserId: "u1",
    });
    expect(fs.existsSync(surface.absolutePath)).toBe(true);
    const listed = listSqliteUniverseTool();
    expect(listed.entries.some((e) => e.kind === "structure")).toBe(true);
    const queried = querySqliteUniverseTool({
      relativePath: surface.relativePath,
      sql: "SELECT name FROM sqlite_master WHERE type='table'",
    });
    expect(Array.isArray(queried.rows)).toBe(true);
    expect(() =>
      querySqliteUniverseTool({
        relativePath: surface.relativePath,
        sql: "DELETE FROM sqlite_master",
      })
    ).toThrow(/read-only/i);
  });
});
