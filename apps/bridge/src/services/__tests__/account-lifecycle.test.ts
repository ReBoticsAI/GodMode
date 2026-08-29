import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Database(":memory:");
mem.pragma("foreign_keys = ON");

vi.mock("../../core-db.js", () => ({
  getCloudDb: () => mem,
  initCoreDb: () => mem,
}));

vi.mock("../../config.js", () => ({
  config: {
    isSaas: true,
    dataDir: "/tmp/gm-lifecycle",
    cloudDbPath: "/tmp/gm-lifecycle/Cloud.sqlite",
    usersDir: "/tmp/gm-lifecycle/users",
    tenantsDir: "/tmp/gm-lifecycle/tenants",
    saas: { plans: [], webhookSecret: "", checkoutMode: "subscription" },
  },
}));

vi.mock("../tenant-bootstrap.js", () => ({
  wipeWorkspaceTenant: (core: Database.Database, tenantId: string) => {
    core.prepare(`DELETE FROM tenants WHERE id=?`).run(tenantId);
  },
}));

import {
  hardWipeUserAccount,
  requestAccountDeletion,
  runAccountRetentionPass,
  softDeleteUserAccount,
} from "../account-lifecycle.js";
import { assertSaasUserMayAccess } from "../saas-subscriptions.js";
import type { CoreUser } from "../../core-db.js";

function seedSchema(): void {
  mem.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      access_disabled INTEGER NOT NULL DEFAULT 0,
      access_disabled_reason TEXT,
      last_seen_at TEXT,
      deleted_at TEXT,
      deletion_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_operator INTEGER NOT NULL DEFAULT 0,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS saas_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      email TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      access_revoked INTEGER NOT NULL DEFAULT 0,
      past_due_since TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS account_deletion_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'requested',
      reason TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      fulfilled_at TEXT,
      fulfilled_by_user_id TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS saas_lifecycle_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_user_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function insertUser(email: string, isAdmin = false): CoreUser {
  const id = randomUUID();
  mem
    .prepare(
      `INSERT INTO users (id, email, display_name, is_admin) VALUES (?, ?, ?, ?)`
    )
    .run(id, email, email.split("@")[0], isAdmin ? 1 : 0);
  return mem.prepare(`SELECT * FROM users WHERE id=?`).get(id) as CoreUser;
}

describe("account lifecycle", () => {
  beforeEach(() => {
    seedSchema();
  });

  afterEach(() => {
    mem.exec(`
      DELETE FROM saas_lifecycle_audit;
      DELETE FROM account_deletion_requests;
      DELETE FROM saas_subscriptions;
      DELETE FROM sessions;
      DELETE FROM tenants;
      DELETE FROM users;
    `);
  });

  it("self-serve deletion soft-deletes and blocks login", () => {
    const user = insertUser("del@example.com");
    mem
      .prepare(
        `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))`
      )
      .run(randomUUID(), user.id);

    const req = requestAccountDeletion(user.id, "leaving");
    expect(req.status).toBe("fulfilled");

    const updated = mem
      .prepare(`SELECT * FROM users WHERE id=?`)
      .get(user.id) as CoreUser;
    expect(updated.deleted_at).toBeTruthy();
    expect(updated.deletion_status).toBe("pending_wipe");
    expect(updated.access_disabled).toBe(1);

    const sessions = mem
      .prepare(`SELECT COUNT(*) AS c FROM sessions WHERE user_id=?`)
      .get(user.id) as { c: number };
    expect(sessions.c).toBe(0);

    const gate = assertSaasUserMayAccess(updated);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.error).toMatch(/scheduled for deletion/i);
  });

  it("retention pass hard-wipes soft-deleted accounts after the window", () => {
    const prev = process.env.SAAS_ACCOUNT_RETENTION_DAYS;
    process.env.SAAS_ACCOUNT_RETENTION_DAYS = "7";
    try {
      const user = insertUser("wipe@example.com");
      const tenantId = randomUUID();
      mem
        .prepare(
          `INSERT INTO tenants (id, name, slug, owner_user_id) VALUES (?, 'T', 't', ?)`
        )
        .run(tenantId, user.id);
      softDeleteUserAccount({
        userId: user.id,
        actorUserId: user.id,
        allowSelfServe: true,
      });
      mem
        .prepare(
          `UPDATE users SET deleted_at=datetime('now', '-8 days') WHERE id=?`
        )
        .run(user.id);

      expect(runAccountRetentionPass()).toBe(1);
      expect(
        mem.prepare(`SELECT id FROM users WHERE id=?`).get(user.id)
      ).toBeUndefined();
      expect(
        mem.prepare(`SELECT id FROM tenants WHERE id=?`).get(tenantId)
      ).toBeUndefined();
      const audit = mem
        .prepare(
          `SELECT action FROM saas_lifecycle_audit WHERE action='account.hard_delete' LIMIT 1`
        )
        .get() as { action: string } | undefined;
      expect(audit?.action).toBe("account.hard_delete");
    } finally {
      if (prev === undefined) delete process.env.SAAS_ACCOUNT_RETENTION_DAYS;
      else process.env.SAAS_ACCOUNT_RETENTION_DAYS = prev;
    }
  });

  it("admin soft-delete then hard wipe is audited", () => {
    const admin = insertUser("admin@example.com", true);
    const user = insertUser("target@example.com");
    softDeleteUserAccount({
      userId: user.id,
      actorUserId: admin.id,
      reason: "ToS",
    });
    hardWipeUserAccount(user.id, admin.id);
    expect(
      mem.prepare(`SELECT id FROM users WHERE id=?`).get(user.id)
    ).toBeUndefined();
  });
});
