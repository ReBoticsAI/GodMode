/**
 * PlatformEvent Cloud → Workspace one-shot migrate (#517).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { CoreDatabase } from "../../core-db.js";
import {
  ensurePlatformEventsWorkspaceSchema,
  PLATFORM_EVENTS_MOVED_META_KEY,
  migratePlatformEventsFromCloud,
} from "../platform-events-workspace-migrate.js";
import { PlatformEventError, emitEvent } from "../event-bus.js";

function openTempDb(filePath: string): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return new Database(filePath);
}

function ensureCloudEventsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
      actor_id TEXT,
      tenant_id TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("migratePlatformEventsFromCloud", () => {
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

  it("copies stamped events to Workspace, deletes from Cloud, keeps orphans, idempotent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gm-pe-migrate-"));
    dirs.push(root);
    const cloud = openTempDb(path.join(root, "Cloud.sqlite")) as CoreDatabase;
    const tenantDb = openTempDb(path.join(root, "tenants", "t1.sqlite"));
    ensureCloudEventsSchema(cloud);
    ensurePlatformEventsWorkspaceSchema(tenantDb);

    const tenantId = "tenant-a";
    cloud
      .prepare(
        `INSERT INTO events (id, type, actor_kind, actor_id, tenant_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("e1", "share.created", "user", "u1", tenantId, "{}");
    cloud
      .prepare(
        `INSERT INTO events (id, type, actor_kind, actor_id, tenant_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("e-orphan", "support.ticket.created", "user", "u1", null, "{}");
    cloud
      .prepare(
        `INSERT INTO events (id, type, actor_kind, actor_id, tenant_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("e-other", "share.created", "user", "u2", "tenant-b", "{}");

    migratePlatformEventsFromCloud(tenantId, tenantDb, cloud);

    const moved = tenantDb
      .prepare(`SELECT id FROM platform_events ORDER BY id`)
      .all() as Array<{ id: string }>;
    expect(moved.map((r) => r.id)).toEqual(["e1"]);

    const cloudLeft = cloud
      .prepare(`SELECT id FROM events ORDER BY id`)
      .all() as Array<{ id: string }>;
    expect(cloudLeft.map((r) => r.id)).toEqual(["e-orphan", "e-other"]);

    const meta = tenantDb
      .prepare(
        `SELECT value FROM platform_events_plane_meta WHERE key=?`
      )
      .get(PLATFORM_EVENTS_MOVED_META_KEY) as { value: string };
    expect(meta.value).toBe("1");

    migratePlatformEventsFromCloud(tenantId, tenantDb, cloud);
    expect(
      (
        tenantDb.prepare(`SELECT COUNT(*) AS c FROM platform_events`).get() as {
          c: number;
        }
      ).c
    ).toBe(1);
  });
});

describe("emitEvent Workspace requirement", () => {
  it("throws when tenantId is missing", () => {
    expect(() =>
      emitEvent({
        type: "share.created",
        actor: { kind: "user", id: "u1" },
        tenantId: "  ",
      })
    ).toThrow(PlatformEventError);
  });
});
