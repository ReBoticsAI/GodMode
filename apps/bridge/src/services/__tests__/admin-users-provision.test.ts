import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createTenantForUser = vi.fn(
  (_core: unknown, userId: string, name: string, slug: string) => {
    const id = `tenant-${slug}`;
    (
      _core as Database.Database
    )
      .prepare(
        `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
         VALUES (?, ?, ?, 0, ?)`
      )
      .run(id, name, slug, userId);
    (
      _core as Database.Database
    )
      .prepare(
        `INSERT INTO tenant_memberships (user_id, tenant_id, role)
         VALUES (?, ?, 'owner')`
      )
      .run(userId, id);
    return id;
  }
);

vi.mock("../tenant-bootstrap.js", async () => {
  const actual = await vi.importActual<typeof import("../tenant-bootstrap.js")>(
    "../tenant-bootstrap.js"
  );
  return {
    ...actual,
    createTenantForUser: (
      core: Database.Database,
      userId: string,
      name: string,
      slug: string
    ) => createTenantForUser(core, userId, name, slug),
    listUserTenants: actual.listUserTenants,
  };
});

vi.mock("../saas-subscriptions.js", () => ({
  userHasActiveComplimentaryAccess: () => false,
}));

vi.mock("../../config.js", () => ({
  config: { isSaas: false },
}));

import { createAdminUser } from "../admin-users.js";

function createCore(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      email_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_operator INTEGER NOT NULL DEFAULT 0,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE tenant_memberships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tenant_id)
    );
    CREATE TABLE credit_wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe("createAdminUser provisioning", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createCore();
    createTenantForUser.mockClear();
  });

  afterEach(() => {
    db.close();
  });

  it("provisions a default personal workspace by default", () => {
    const user = createAdminUser(db as never, {
      email: "new@example.test",
      password: "secret12",
      displayName: "New User",
      markEmailVerified: true,
    });
    expect(createTenantForUser).toHaveBeenCalledOnce();
    expect(user.tenants).toHaveLength(1);
    expect(user.tenants[0]?.name).toBe("New User's Project");
    const row = db
      .prepare(`SELECT email_verified_at FROM users WHERE id=?`)
      .get(user.id) as { email_verified_at: string | null };
    expect(row.email_verified_at).toBeTruthy();
  });

  it("skips workspace provisioning when provisionDefaultTenant is false", () => {
    const user = createAdminUser(db as never, {
      email: "bare@example.test",
      password: "secret12",
      provisionDefaultTenant: false,
      markEmailVerified: true,
    });
    expect(createTenantForUser).not.toHaveBeenCalled();
    expect(user.tenants).toHaveLength(0);
  });
});
