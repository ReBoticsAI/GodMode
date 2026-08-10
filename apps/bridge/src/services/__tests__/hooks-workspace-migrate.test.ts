/**
 * Hooks Cloud → Workspace one-shot migrate (#514).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import {
  ensureHooksWorkspaceSchema,
  HOOKS_MOVED_META_KEY,
  migrateHooksFromCloud,
} from "../hooks-workspace-migrate.js";

function openTempDb(filePath: string): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return new Database(filePath);
}

/** Minimal Cloud hooks DDL (migrate source; mirrors core-db tables). */
function ensureCloudHooksSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'agent')),
      owner_id TEXT NOT NULL,
      owner_tenant_id TEXT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('event', 'schedule')),
      event_type TEXT,
      schedule_cron TEXT,
      condition_json TEXT,
      action_kind TEXT NOT NULL,
      action_config_json TEXT,
      rate_limit_per_hour INTEGER,
      require_approval INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fired_at TEXT
    );
    CREATE TABLE IF NOT EXISTS hook_runs (
      id TEXT PRIMARY KEY,
      hook_id TEXT NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
      event_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped', 'pending_approval')),
      detail TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("migrateHooksFromCloud", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("copies tenant hooks + runs to Workspace, deletes from Cloud, keeps orphans, and is idempotent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gm-hooks-migrate-"));
    dirs.push(root);
    const cloudPath = path.join(root, "Cloud.sqlite");
    const tenantPath = path.join(root, "tenants", "t1.sqlite");

    const cloud = openTempDb(cloudPath) as CoreDatabase;
    const tenantDb = openTempDb(tenantPath);
    ensureCloudHooksSchema(cloud);
    ensureHooksWorkspaceSchema(tenantDb);

    const tenantId = "tenant-a";
    const hookId = "hook-1";
    const orphanId = "hook-orphan";
    cloud
      .prepare(
        `INSERT INTO hooks
           (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
            trigger_kind, event_type, action_kind, require_approval)
         VALUES (?, 'user', 'user-1', ?, 'Notify', 1, 'event', 'dm.message.created', 'notify', 0)`
      )
      .run(hookId, tenantId);
    cloud
      .prepare(
        `INSERT INTO hook_runs (id, hook_id, status, detail)
         VALUES ('run-1', ?, 'success', 'ok')`
      )
      .run(hookId);
    cloud
      .prepare(
        `INSERT INTO hooks
           (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
            trigger_kind, event_type, action_kind, require_approval)
         VALUES (?, 'user', 'user-1', NULL, 'Orphan', 1, 'event', 'dm.*', 'notify', 0)`
      )
      .run(orphanId);

    migrateHooksFromCloud(tenantId, tenantDb, cloud);

    const onTenant = tenantDb
      .prepare(`SELECT id, name FROM hooks WHERE owner_tenant_id = ?`)
      .get(tenantId) as { id: string; name: string } | undefined;
    expect(onTenant).toEqual({ id: hookId, name: "Notify" });
    expect(
      (
        tenantDb
          .prepare(`SELECT COUNT(*) AS n FROM hook_runs WHERE hook_id = ?`)
          .get(hookId) as { n: number }
      ).n
    ).toBe(1);

    expect(
      (
        cloud
          .prepare(`SELECT COUNT(*) AS n FROM hooks WHERE owner_tenant_id = ?`)
          .get(tenantId) as { n: number }
      ).n
    ).toBe(0);
    expect(
      (
        cloud
          .prepare(`SELECT COUNT(*) AS n FROM hook_runs WHERE hook_id = ?`)
          .get(hookId) as { n: number }
      ).n
    ).toBe(0);
    expect(
      (
        cloud
          .prepare(`SELECT id FROM hooks WHERE id = ?`)
          .get(orphanId) as { id: string } | undefined
      )?.id
    ).toBe(orphanId);

    const meta = tenantDb
      .prepare(`SELECT value FROM hooks_plane_meta WHERE key = ?`)
      .get(HOOKS_MOVED_META_KEY) as { value: string } | undefined;
    expect(meta?.value).toBe("1");

    // Second migrate must be a no-op (idempotent).
    cloud
      .prepare(
        `INSERT INTO hooks
           (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
            trigger_kind, event_type, action_kind, require_approval)
         VALUES ('hook-cloud-only', 'user', 'user-1', ?, 'Nope', 1,
            'event', 'dm.*', 'notify', 0)`
      )
      .run(tenantId);
    migrateHooksFromCloud(tenantId, tenantDb, cloud);
    expect(
      (
        tenantDb
          .prepare(`SELECT COUNT(*) AS n FROM hooks WHERE id = 'hook-cloud-only'`)
          .get() as { n: number }
      ).n
    ).toBe(0);
    expect(
      (
        tenantDb
          .prepare(`SELECT COUNT(*) AS n FROM hooks WHERE owner_tenant_id = ?`)
          .get(tenantId) as { n: number }
      ).n
    ).toBe(1);

    cloud.close();
    tenantDb.close();
  });
});
