/**
 * Host Users.sqlite hub split (#501 / #499).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot, tenantsDir, usersDir, cloudDbPath, hostUsersDbPath } = vi.hoisted(
  () => {
    const f = require("node:fs") as typeof import("node:fs");
    const o = require("node:os") as typeof import("node:os");
    const p = require("node:path") as typeof import("node:path");
    const root = f.mkdtempSync(p.join(o.tmpdir(), "gm-host-users-"));
    return {
      tmpRoot: root,
      tenantsDir: p.join(root, "tenants"),
      usersDir: p.join(root, "users"),
      cloudDbPath: p.join(root, "Cloud.sqlite"),
      hostUsersDbPath: p.join(root, "Users.sqlite"),
    };
  }
);

vi.mock("../../config.js", async () => {
  const actual = await vi.importActual<typeof import("../../config.js")>(
    "../../config.js"
  );
  return {
    ...actual,
    config: {
      ...actual.config,
      dataDir: tmpRoot,
      usersDir,
      tenantsDir,
      cloudDbPath,
      hostUsersDbPath,
    },
  };
});

import Database from "better-sqlite3";
import { getCloudDb, getPlatformMeta } from "../../core-db.js";
import {
  closeHostUsersDbForTests,
  getHostUsersDb,
  HUB_TABLE_COPY_ORDER,
  migrateHubTablesFromCore,
} from "../../host-users-db.js";
import {
  createNotification,
  listNotificationsForUser,
} from "../notification-service.js";
import { getGroupBySlug } from "../platform-groups.js";
import { tableExists } from "../db-migrations.js";

describe("host Users hub split", () => {
  beforeEach(() => {
    fs.mkdirSync(usersDir, { recursive: true });
    fs.mkdirSync(tenantsDir, { recursive: true });
    closeHostUsersDbForTests();
  });

  afterEach(() => {
    closeHostUsersDbForTests();
  });

  it("opens Users.sqlite with hub tables and Support group", () => {
    const core = getCloudDb();
    expect(getPlatformMeta(core, "hub_tables_moved_to_users_v1")).toBe("1");
    const hub = getHostUsersDb();
    expect(tableExists(hub, "notifications")).toBe(true);
    expect(tableExists(hub, "dm_conversations")).toBe(true);
    expect(tableExists(hub, "support_tickets")).toBe(true);
    expect(getGroupBySlug("support", hub)?.name).toBe("Support");
    for (const table of HUB_TABLE_COPY_ORDER) {
      expect(tableExists(core, table)).toBe(false);
    }
  });

  it("writes notifications to Users.sqlite not Cloud", () => {
    getCloudDb();
    const note = createNotification({
      recipientKind: "user",
      recipientId: "user-1",
      title: "Hub probe",
      body: "from Users.sqlite",
    });
    const listed = listNotificationsForUser("user-1");
    expect(listed.some((n) => n.id === note.id)).toBe(true);
    expect(tableExists(getCloudDb(), "notifications")).toBe(false);
  });

  it("copies legacy hub rows from a core handle into Users", () => {
    closeHostUsersDbForTests();
    if (fs.existsSync(hostUsersDbPath)) fs.unlinkSync(hostUsersDbPath);

    const legacyPath = path.join(tmpRoot, "legacy-core.sqlite");
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE platform_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
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
    legacy
      .prepare(
        `INSERT INTO notifications (id, recipient_kind, recipient_id, title, body)
         VALUES ('n-legacy', 'user', 'u1', 'Legacy', 'moved')`
      )
      .run();

    // Point migrate at this handle: temporarily swap by copying schema into
    // a dedicated migrate using the same Users path from mocked config.
    migrateHubTablesFromCore(legacy as never);
    const hub = getHostUsersDb();
    const row = hub
      .prepare(`SELECT title, body FROM notifications WHERE id = ?`)
      .get("n-legacy") as { title: string; body: string } | undefined;
    expect(row?.title).toBe("Legacy");
    expect(tableExists(legacy as never, "notifications")).toBe(false);
    expect(
      legacy
        .prepare(`SELECT value FROM platform_meta WHERE key=?`)
        .get("hub_tables_moved_to_users_v1") as { value: string }
    ).toEqual({ value: "1" });
    legacy.close();
  });
});
