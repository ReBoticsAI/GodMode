import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Router } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { setPluginHost } from "@godmode/plugin-host";
import { config } from "../../config.js";
import { pluginRuntime } from "../../plugins/runtime.js";
import { unregisterObjectTypesByPlugin } from "../../kernel/registry.js";
import { evictTenantDb, getTenantDb } from "../../tenant-registry.js";
import { listInstalledPlugins } from "../../plugins/plugin-install.js";
import { scaffoldPlugin } from "../plugin-scaffold.js";
import { buildPluginWithEsbuild } from "../plugin-build.js";
import {
  activatePluginForTenant,
  ensureTenantPluginsStorage,
} from "../plugin-lifecycle.js";
import {
  assertLivePluginRoot,
  isLocalPluginFolderRegistrationBlocked,
  isPluginLoopError,
  notifyPluginLoopFailure,
} from "../plugin-loop-error.js";

const temps: string[] = [];
const previousTenantsDir = config.tenantsDir;

afterEach(() => {
  pluginRuntime.unregister("pipeline-bar");
  unregisterObjectTypesByPlugin("pipeline-bar");
  evictTenantDb("tenant-a");
  config.tenantsDir = previousTenantsDir;
  while (temps.length) {
    fs.rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function memoryCore() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE platform_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO tenants (id, name) VALUES ('tenant-a', 'Tenant A');
  `);
  ensureTenantPluginsStorage(db);
  return db;
}

describe("plugin loop reliability (#433)", () => {
  it("refuses install roots under .worktrees", () => {
    expect(() =>
      assertLivePluginRoot("/data/tenant-a/.worktrees/wip/plugins/demo")
    ).toThrow(/worktrees/);
    try {
      assertLivePluginRoot("C:\\data\\tenant-a\\.worktrees\\wip\\plugins\\demo");
      throw new Error("expected isolation failure");
    } catch (err) {
      expect(isPluginLoopError(err)).toBe(true);
      if (isPluginLoopError(err)) expect(err.failureClass).toBe("isolation");
    }
  });

  it("blocks arbitrary local folder registration on SaaS unless explicitly allowed", () => {
    expect(
      isLocalPluginFolderRegistrationBlocked({
        isSaas: true,
        saasAllowLocalPlugins: false,
      })
    ).toBe(true);
    expect(
      isLocalPluginFolderRegistrationBlocked({
        isSaas: true,
        saasAllowLocalPlugins: true,
      })
    ).toBe(false);
    expect(
      isLocalPluginFolderRegistrationBlocked({
        isSaas: false,
        saasAllowLocalPlugins: false,
      })
    ).toBe(false);
  });

  it("scaffolds, builds, and activates inside a tenant workspace", async () => {
    const root = tempDir("gm-loop-");
    const workspaces = path.join(root, "tenant-workspaces");
    config.tenantsDir = path.join(root, "tenants");
    fs.mkdirSync(config.tenantsDir, { recursive: true });

    setPluginHost({
      getTenantDb: (tenantId: string) => getTenantDb(tenantId),
      getReqTenantDb: () => {
        throw new Error("not used");
      },
      createPluginRouter: () => Router(),
      getTimeseriesStore: () => null,
      bootstrapTradingDepartment: () => undefined,
      bridgeFetch: async () => new Response(),
    } as never);

    pluginRuntime.configure({
      operatorTenantId: "tenant-a",
      bus: new EventEmitter(),
    });

    const scaffold = scaffoldPlugin({
      id: "pipeline-bar",
      name: "Pipeline Bar",
      tenantId: "tenant-a",
      isolatedDeployment: true,
      tenantWorkspacesDir: workspaces,
    });
    expect(scaffold.created).toBe(true);
    expect(scaffold.pluginRoot.replace(/\\/g, "/")).toContain(
      "tenant-workspaces/tenant-a/plugins/pipeline-bar"
    );

    const built = await buildPluginWithEsbuild(scaffold.pluginRoot);
    expect(built.ok).toBe(true);

    const core = memoryCore();
    const activated = await activatePluginForTenant(
      core,
      "tenant-a",
      scaffold.pluginRoot
    );
    expect(activated.pluginId).toBe("pipeline-bar");
    expect(activated.installed).toBe(true);
    expect(pluginRuntime.hasPlugin("pipeline-bar")).toBe(true);
    expect(pluginRuntime.getToolHandler("pipeline-bar_hello")).toBeTruthy();

    const installed = listInstalledPlugins(core, "tenant-a");
    expect(installed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plugin_id: "pipeline-bar",
          state: "active",
        }),
      ])
    );

    const worktreeRoot = path.join(
      workspaces,
      "tenant-a",
      ".worktrees",
      "wip",
      "plugins",
      "pipeline-bar"
    );
    fs.mkdirSync(worktreeRoot, { recursive: true });
    fs.copyFileSync(
      path.join(scaffold.pluginRoot, "godmode.plugin.json"),
      path.join(worktreeRoot, "godmode.plugin.json")
    );
    await expect(
      activatePluginForTenant(core, "tenant-a", worktreeRoot)
    ).rejects.toMatchObject({ failureClass: "isolation" });
  });

  it("records plugin loop failures as Attention notifications", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        recipient_kind TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        recipient_tenant_id TEXT,
        category TEXT NOT NULL DEFAULT 'system',
        title TEXT NOT NULL,
        body TEXT,
        link TEXT,
        resource_kind TEXT,
        resource_id TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    notifyPluginLoopFailure({
      db,
      tenantId: "tenant-a",
      userId: "user-1",
      agentId: "agent-1",
      pluginId: "pipeline-bar",
      failureClass: "build",
      message: "esbuild failed",
    });
    const rows = db
      .prepare(`SELECT recipient_kind, title, category FROM notifications ORDER BY recipient_kind`)
      .all() as Array<{ recipient_kind: string; title: string; category: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.recipient_kind).sort()).toEqual(["agent", "user"]);
    expect(rows[0]?.category).toBe("plugin_loop");
    expect(rows[0]?.title).toMatch(/build/i);
  });
});
