import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("plugin-sqlite", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gm-plugin-sqlite-"));
    vi.resetModules();
    process.env.PLATFORM_DATA_DIR = tmp;
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.PLATFORM_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("opens a file under plugin-data/{tenant}/{plugin}.sqlite", async () => {
    const { openPluginSqlite, pluginSqlitePath, closeAllPluginSqlite } =
      await import("../plugin-sqlite.js");
    const db = openPluginSqlite("entropia", "tenant-a");
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY); INSERT INTO t VALUES ('1')`);
    expect(
      (db.prepare(`SELECT id FROM t`).get() as { id: string }).id
    ).toBe("1");
    expect(pluginSqlitePath("entropia", "tenant-a")).toBe(
      path.join(tmp, "plugin-data", "tenant-a", "entropia.sqlite")
    );
    expect(fs.existsSync(pluginSqlitePath("entropia", "tenant-a"))).toBe(true);
    closeAllPluginSqlite();
  });

  it("rejects invalid plugin ids", async () => {
    const { openPluginSqlite } = await import("../plugin-sqlite.js");
    expect(() => openPluginSqlite("../evil", "tenant-a")).toThrow(/Invalid pluginId/);
  });

  it("closePluginSqlite clears the handle while retaining the file", async () => {
    const {
      openPluginSqlite,
      closePluginSqlite,
      isPluginSqliteOpen,
      pluginSqlitePath,
      closeAllPluginSqlite,
    } = await import("../plugin-sqlite.js");
    openPluginSqlite("demo", "tenant-a");
    expect(isPluginSqliteOpen("demo", "tenant-a")).toBe(true);
    closePluginSqlite("demo", "tenant-a");
    expect(isPluginSqliteOpen("demo", "tenant-a")).toBe(false);
    expect(fs.existsSync(pluginSqlitePath("demo", "tenant-a"))).toBe(true);
    closeAllPluginSqlite();
  });

  it("deletePluginDataForTenant removes the tenant plugin-data tree", async () => {
    const {
      openPluginSqlite,
      deletePluginDataForTenant,
      pluginSqlitePath,
      closeAllPluginSqlite,
    } = await import("../plugin-sqlite.js");
    openPluginSqlite("demo", "tenant-a");
    const file = pluginSqlitePath("demo", "tenant-a");
    expect(fs.existsSync(file)).toBe(true);
    deletePluginDataForTenant("tenant-a");
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(tmp, "plugin-data", "tenant-a"))).toBe(false);
    closeAllPluginSqlite();
  });

  it("backupPluginDataTree copies plugin SQLite files into the stamp layout", async () => {
    const {
      openPluginSqlite,
      backupPluginDataTree,
      closeAllPluginSqlite,
    } = await import("../plugin-sqlite.js");
    const db = openPluginSqlite("demo", "tenant-a");
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY); INSERT INTO t VALUES ('x')`);
    const stampPluginData = path.join(tmp, "stamp", "plugin-data");
    const copied = await backupPluginDataTree(stampPluginData, async (src, dest) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await src.backup(dest);
    });
    expect(copied).toContain("tenant-a/demo.sqlite");
    const destFile = path.join(stampPluginData, "tenant-a", "demo.sqlite");
    expect(fs.existsSync(destFile)).toBe(true);
    const verify = new Database(destFile, { readonly: true });
    expect((verify.prepare(`SELECT id FROM t`).get() as { id: string }).id).toBe("x");
    verify.close();
    closeAllPluginSqlite();
  });
});
