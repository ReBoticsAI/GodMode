import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
});
