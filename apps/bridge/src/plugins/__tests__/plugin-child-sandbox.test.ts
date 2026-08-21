import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Router } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPluginHost } from "@godmode/plugin-host";
import { config } from "../../config.js";
import { pluginRuntime } from "../runtime.js";
import { loadPluginFromRoot } from "../loader.js";
import {
  communityPluginChildPid,
  setPluginChildFailureNotify,
} from "../plugin-child-host.js";
import { evictTenantDb, getTenantDb } from "../../tenant-registry.js";

const PLUGIN_ID = "community-sandbox";
const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "community-sandbox"
);
const previousTenantsDir = config.tenantsDir;
const previousDataDir = config.dataDir;
const tenantTemps: string[] = [];
const dataTemps: string[] = [];

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 10_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for plugin child condition");
}

function memoryNotifyDb() {
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
  return db;
}

describe("Community plugin child-process sandbox (#559)", { timeout: 30_000 }, () => {
  beforeEach(() => {
    setPluginHost({
      getTenantDb: () => {
        throw new Error("not used");
      },
      getReqTenantDb: () => {
        throw new Error("not used");
      },
      createPluginRouter: () => Router(),
      getTimeseriesStore: () => {
        throw new Error("not used");
      },
      bootstrapTradingDepartment: () => undefined,
      bridgeFetch: async () => new Response(),
    } as never);
    pluginRuntime.configure({
      operatorTenantId: "tenant-a",
      bus: new EventEmitter(),
    });
    pluginRuntime.unregister(PLUGIN_ID);
  });

  afterEach(() => {
    pluginRuntime.unregister(PLUGIN_ID);
    setPluginChildFailureNotify(null);
    evictTenantDb("tenant-a");
    config.tenantsDir = previousTenantsDir;
    config.dataDir = previousDataDir;
    while (tenantTemps.length) {
      fs.rmSync(tenantTemps.pop()!, { recursive: true, force: true });
    }
    while (dataTemps.length) {
      fs.rmSync(dataTemps.pop()!, { recursive: true, force: true });
    }
  });

  it("spawns a child, round-trips a tool, and denies undeclared hosts", async () => {
    const loaded = await loadPluginFromRoot(fixtureRoot);
    expect(loaded.pluginId).toBe(PLUGIN_ID);
    const pid = communityPluginChildPid(PLUGIN_ID);
    expect(pid).toBeTypeOf("number");
    expect(pidAlive(pid!)).toBe(true);

    const def = pluginRuntime.getToolHandler("sandbox_ping");
    expect(def?.pluginId).toBe(PLUGIN_ID);
    const ctx = pluginRuntime.buildToolContext({ tenantId: "tenant-a" });
    const ping = await def!.handler!({}, ctx);
    expect(ping).toEqual({ ok: true, plugin: PLUGIN_ID });

    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("sandbox-ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const fetched = await def!.handler!(
        { url: `http://127.0.0.1:${port}/hello` },
        ctx
      );
      expect(fetched).toEqual({
        ok: true,
        status: 200,
        body: "sandbox-ok",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    await expect(
      def!.handler!({ url: "https://example.com/" }, ctx)
    ).rejects.toThrow(/denied|allowlist/i);
  });

  it("kills the child PID on unregister", async () => {
    await loadPluginFromRoot(fixtureRoot);
    const pid = communityPluginChildPid(PLUGIN_ID);
    expect(pid).toBeTypeOf("number");
    pluginRuntime.unregister(PLUGIN_ID);
    expect(communityPluginChildPid(PLUGIN_ID)).toBeUndefined();
    await waitFor(() => !pidAlive(pid!));
  });

  it("fires Attention on unexpected child exit and leaves Bridge up", async () => {
    const db = memoryNotifyDb();
    setPluginChildFailureNotify({
      db,
      tenantId: "tenant-a",
      userId: "user-1",
    });
    await loadPluginFromRoot(fixtureRoot);
    const def = pluginRuntime.getToolHandler("sandbox_ping");
    const ctx = pluginRuntime.buildToolContext({ tenantId: "tenant-a" });
    void def!.handler!({ crash: true }, ctx).catch(() => undefined);

    await waitFor(() => {
      const count = (
        db.prepare("SELECT COUNT(*) AS n FROM notifications").get() as {
          n: number;
        }
      ).n;
      return count > 0 && !pluginRuntime.hasPlugin(PLUGIN_ID);
    });
    const rows = db
      .prepare("SELECT category, title, resource_id FROM notifications")
      .all() as Array<{
      category: string;
      title: string;
      resource_id: string | null;
    }>;
    expect(rows.some((row) => row.category === "plugin_loop")).toBe(true);
    expect(rows.some((row) => /install/i.test(row.title))).toBe(true);
    expect(rows.some((row) => row.resource_id === PLUGIN_ID)).toBe(true);
    expect(pluginRuntime.hasPlugin(PLUGIN_ID)).toBe(false);

    const again = await loadPluginFromRoot(fixtureRoot);
    expect(again.pluginId).toBe(PLUGIN_ID);
    expect(communityPluginChildPid(PLUGIN_ID)).toBeTypeOf("number");
    db.close();
  });

  it("respawns the child on hot-reload", async () => {
    await loadPluginFromRoot(fixtureRoot);
    const first = communityPluginChildPid(PLUGIN_ID);
    expect(first).toBeTypeOf("number");
    await loadPluginFromRoot(fixtureRoot, { reload: true });
    const second = communityPluginChildPid(PLUGIN_ID);
    expect(second).toBeTypeOf("number");
    expect(second).not.toBe(first);
    await waitFor(() => !pidAlive(first!));
  });

  it("seeds structure_nodes over IPC and denies other SQL", async () => {
    const tenantsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-child-struct-"));
    tenantTemps.push(tenantsDir);
    config.tenantsDir = tenantsDir;
    getTenantDb("tenant-a");

    await loadPluginFromRoot(fixtureRoot);
    await pluginRuntime.installPluginForTenant(PLUGIN_ID, "tenant-a");

    const rows = getTenantDb("tenant-a")
      .prepare(
        "SELECT id, parent_id, label FROM structure_nodes WHERE id LIKE 'workspace-pulse%' ORDER BY id"
      )
      .all() as Array<{ id: string; parent_id: string | null; label: string }>;
    expect(rows).toEqual([
      { id: "workspace-pulse", parent_id: null, label: "Workspace Pulse" },
      {
        id: "workspace-pulse-health",
        parent_id: "workspace-pulse",
        label: "Health",
      },
      {
        id: "workspace-pulse-pulse",
        parent_id: "workspace-pulse-health",
        label: "Pulse",
      },
    ]);

    const def = pluginRuntime.getToolHandler("sandbox_ping");
    const ctx = pluginRuntime.buildToolContext({ tenantId: "tenant-a" });
    await expect(
      def!.handler!(
        { sql: "SELECT * FROM structure_nodes", params: [] },
        ctx
      )
    ).rejects.toThrow(/structure_nodes|INSERT OR IGNORE/i);
  });

  it("opens plugin SQLite under plugin-data and rejects cross-plugin ids", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-child-pdata-"));
    dataTemps.push(dataDir);
    config.dataDir = dataDir;

    const tenantsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-child-struct-"));
    tenantTemps.push(tenantsDir);
    config.tenantsDir = tenantsDir;
    getTenantDb("tenant-a");

    await loadPluginFromRoot(fixtureRoot);
    await pluginRuntime.installPluginForTenant(PLUGIN_ID, "tenant-a");

    const expectedPath = path.join(
      dataDir,
      "plugin-data",
      "tenant-a",
      `${PLUGIN_ID}.sqlite`
    );
    expect(fs.existsSync(expectedPath)).toBe(true);

    const def = pluginRuntime.getToolHandler("sandbox_ping");
    const ctx = pluginRuntime.buildToolContext({ tenantId: "tenant-a" });
    await expect(
      def!.handler!(
        { pluginDb: "write", id: "s1", payload: '{"n":1}' },
        ctx
      )
    ).resolves.toEqual({ ok: true, wrote: "s1" });
    await expect(
      def!.handler!({ pluginDb: "read", id: "s1" }, ctx)
    ).resolves.toEqual({
      ok: true,
      row: { id: "s1", payload_json: '{"n":1}' },
    });

    await expect(
      def!.handler!({ pluginDb: "cross", otherPluginId: "other-plugin" }, ctx)
    ).rejects.toThrow(/only openPluginDb for itself/i);
  });
});
