import Database from "better-sqlite3";
import type { ObjectTypeDef } from "@godmode/kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../services/auth/password.js";
import type { OperationContext } from "../adapter-registry.js";
import {
  configureIdentityAdminAdapterServices,
  resetIdentityAdminAdapterServices,
  tenantAdminAdapter,
  tenantMembershipAdapter,
  tenantProvisioningRunAdapter,
  userAdminAdapter,
  userCredentialAdapter,
  userProfileAdapter,
} from "../adapters/identity-admin.js";

function definition(name: string, adapterId: string, fields: string[]): ObjectTypeDef {
  return {
    name,
    label: name,
    labelPlural: `${name}s`,
    module: "platform",
    database: "core",
    storage: { kind: "adapter", adapterId },
    fields: fields.map((field) => ({
      name: field,
      label: field,
      fieldType: "Data",
    })),
    permissions: [{ role: "owner", read: true, create: true, update: true, delete: true }],
    operations: ["list", "get", "create", "update", "delete"],
    contractVersion: 1,
    schemaVersion: 1,
  };
}

function context(
  db: Database.Database,
  overrides: Partial<OperationContext> = {}
): OperationContext {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    role: "owner",
    source: "http",
    data: {
      coreDb: db,
      tenantDb: db,
      declaredDatabase: "core",
    },
    ...overrides,
  };
}

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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE oauth_accounts (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (provider, provider_user_id)
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
    CREATE TABLE user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      headline TEXT, bio TEXT, pronouns TEXT, location TEXT, timezone TEXT,
      phone TEXT, company TEXT, job_title TEXT, website TEXT, twitter TEXT,
      github TEXT, linkedin TEXT, emoji TEXT, birthday TEXT, languages TEXT,
      interests TEXT, "values" TEXT, goals TEXT, personality_notes TEXT,
      decision_style TEXT, risk_tolerance TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE platform_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE credit_wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE share_grants (
      id TEXT PRIMARY KEY,
      owner_tenant_id TEXT,
      grantee_tenant_id TEXT
    );
    CREATE TABLE bridge_connections (
      id TEXT PRIMARY KEY,
      owner_tenant_id TEXT
    );
  `);
  const insertUser = db.prepare(
    `INSERT INTO users
       (id, email, display_name, is_admin, password_hash)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertUser.run("system-local", "local@godmode.platform", "System", 0, null);
  insertUser.run("admin", "admin@example.test", "Admin", 1, hashPassword("admin-pass"));
  insertUser.run("user-a", "a@example.test", "User A", 0, hashPassword("password-a"));
  insertUser.run("user-b", "b@example.test", "User B", 0, hashPassword("password-b"));
  db.prepare(
    `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run("operator", "Operator", "operator", 1, "admin");
  db.prepare(
    `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run("tenant-a", "Tenant A", "tenant-a", 0, "user-a");
  db.prepare(
    `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run("tenant-b", "Tenant B", "tenant-b", 0, "user-b");
  const membership = db.prepare(
    `INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES (?, ?, ?)`
  );
  membership.run("admin", "operator", "owner");
  membership.run("user-a", "tenant-a", "owner");
  membership.run("user-b", "tenant-b", "owner");
  return db;
}

describe("identity and admin ObjectType adapters", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createCore();
    configureIdentityAdminAdapterServices({
      signup(core, input) {
        const id = "signed-up-user";
        core.prepare(
          `INSERT INTO users
             (id, email, display_name, is_admin, password_hash)
           VALUES (?, ?, ?, 0, ?)`
        ).run(id, input.email, input.displayName ?? "Signed Up", hashPassword(input.password));
        return {
          id,
          email: input.email,
          displayName: input.displayName ?? "Signed Up",
          avatarUrl: null,
          isAdmin: false,
          createdAt: "now",
          tenants: [],
        };
      },
      refreshProfile() {},
      createTenant(core, userId, name, slug) {
        const id = `tenant-${slug ?? name.toLowerCase().replace(/\s+/g, "-")}`;
        core
          .prepare(
            `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
             VALUES (?, ?, ?, 0, ?)`
          )
          .run(id, name, slug ?? id, userId);
        core
          .prepare(
            `INSERT INTO tenant_memberships (user_id, tenant_id, role)
             VALUES (?, ?, 'owner')`
          )
          .run(userId, id);
        return { id, name, slug: slug ?? id };
      },
      deleteTenant(core, tenantId) {
        core.prepare(`DELETE FROM tenants WHERE id=? AND is_operator=0`).run(tenantId);
      },
    });
  });

  afterEach(() => {
    resetIdentityAdminAdapterServices();
    db.close();
  });

  it("allows signup only through trusted system transport", () => {
    const def = definition("User", "user_admin_service", [
      "id",
      "email",
      "display_name",
      "is_admin",
    ]);
    expect(() =>
      userAdminAdapter.actions!.signup(
        db,
        def,
        "",
        { email: "new@example.test", password: "password", display_name: "New" },
        context(db)
      )
    ).toThrow(/trusted authentication transport/i);

    const created = userAdminAdapter.actions!.signup(
      db,
      def,
      "",
      { email: "new@example.test", password: "password", display_name: "New" },
      context(db, { source: "system", userId: undefined, agentId: "system" })
    );
    expect(created).toMatchObject({
      id: "signed-up-user",
      data: { email: "new@example.test", display_name: "New" },
    });
  });

  it("lets platform admins reset another user's password", () => {
    const def = definition("User", "user_admin_service", [
      "id",
      "email",
      "display_name",
      "is_admin",
    ]);
    const before = db
      .prepare(`SELECT password_hash FROM users WHERE id='user-b'`)
      .get() as { password_hash: string };
    const result = userAdminAdapter.actions!.reset_password(
      db,
      def,
      "user-b",
      { new_password: "replacement-b" },
      context(db, { isAdmin: true, userId: "admin" })
    );
    expect(result.data).not.toHaveProperty("password_hash");
    expect(result.data).not.toHaveProperty("password");
    const after = db
      .prepare(`SELECT password_hash FROM users WHERE id='user-b'`)
      .get() as { password_hash: string };
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(verifyPassword("replacement-b", after.password_hash)).toBe(true);
    expect(() =>
      userAdminAdapter.actions!.reset_password(
        db,
        def,
        "user-b",
        { new_password: "another-pass" },
        context(db, { isAdmin: false, userId: "user-b" })
      )
    ).toThrow(/admin/i);
  });

  it("isolates profiles and memberships between two tenants", () => {
    const profileDef = definition("UserProfile", "user_profile_service", [
      "id",
      "user_id",
      "display_name",
      "headline",
    ]);
    const membershipDef = definition(
      "TenantMembership",
      "tenant_membership_service",
      ["id", "user_id", "tenant_id", "role"]
    );
    const ctxA = context(db);
    const ctxB = context(db, { tenantId: "tenant-b", userId: "user-b" });

    expect(userProfileAdapter.list!(db, profileDef, {}, ctxA).total).toBe(1);
    expect(userProfileAdapter.get!(db, profileDef, "user-b", ctxA)).toBeNull();
    userProfileAdapter.update!(
      db,
      profileDef,
      "user-a",
      { headline: "Tenant A only" },
      ctxA
    );
    expect(
      userProfileAdapter.get!(db, profileDef, "user-a", ctxA)?.data.headline
    ).toBe("Tenant A only");
    expect(
      userProfileAdapter.get!(db, profileDef, "user-b", ctxB)?.data.headline
    ).toBeNull();

    expect(tenantMembershipAdapter.list!(db, membershipDef, {}, ctxA).total).toBe(1);
    expect(tenantMembershipAdapter.list!(db, membershipDef, {}, ctxB).total).toBe(1);
    expect(
      tenantMembershipAdapter.get!(
        db,
        membershipDef,
        "tenant-b:user-b",
        ctxA
      )
    ).toBeNull();
  });

  it("protects system, operator, and last-owner identities", () => {
    const userDef = definition("User", "user_admin_service", [
      "id",
      "email",
      "display_name",
      "is_admin",
    ]);
    const membershipDef = definition(
      "TenantMembership",
      "tenant_membership_service",
      ["id", "user_id", "tenant_id", "role"]
    );
    const admin = context(db, {
      tenantId: "operator",
      userId: "admin",
      isAdmin: true,
    });

    expect(userAdminAdapter.list!(db, userDef, {}, admin).records).toHaveLength(3);
    expect(userAdminAdapter.get!(db, userDef, "system-local", admin)).toBeNull();
    expect(() =>
      userAdminAdapter.delete!(db, userDef, "admin", admin)
    ).toThrow(/own account/i);
    expect(() =>
      userAdminAdapter.update!(
        db,
        userDef,
        "admin",
        { is_admin: false },
        admin
      )
    ).toThrow(/operator tenant owner/i);
    expect(() =>
      tenantMembershipAdapter.delete!(
        db,
        membershipDef,
        "operator:admin",
        admin
      )
    ).toThrow(/operator tenant owner/i);
    expect(() =>
      tenantMembershipAdapter.delete!(
        db,
        membershipDef,
        "tenant-a:user-a",
        context(db)
      )
    ).toThrow(/last workspace owner/i);
  });

  it("changes passwords without projecting credential material", () => {
    const def = definition("UserCredential", "user_credential_service", [
      "id",
      "user_id",
      "has_password",
      "has_oauth",
      "updated_at",
    ]);
    const ctx = context(db);
    const before = userCredentialAdapter.get!(db, def, "user-a", ctx)!;
    expect(before.data).not.toHaveProperty("password_hash");
    expect(before.data).not.toHaveProperty("password");

    const changed = userCredentialAdapter.actions!.change_password(
      db,
      def,
      "user-a",
      {
        current_password: "password-a",
        new_password: "replacement-a",
      },
      ctx
    ) as { data: Record<string, unknown> };
    expect(changed.data).not.toHaveProperty("password_hash");
    const stored = db
      .prepare(`SELECT password_hash FROM users WHERE id='user-a'`)
      .get() as { password_hash: string };
    expect(verifyPassword("replacement-a", stored.password_hash)).toBe(true);
  });

  it("persists tenant provisioning and deprovisioning run state", () => {
    const tenantDef = definition("Tenant", "tenant_admin_service", [
      "id",
      "name",
      "slug",
      "owner_user_id",
    ]);
    const runDef = definition(
      "TenantProvisioningRun",
      "tenant_provisioning_run_service",
      ["id", "operation", "status", "actor_user_id", "tenant_id", "error"]
    );
    const admin = context(db, {
      tenantId: "operator",
      userId: "admin",
      isAdmin: true,
    });

    const created = tenantAdminAdapter.actions!.provision(
      db,
      tenantDef,
      "",
      { owner_user_id: "user-a", name: "Second A", slug: "second-a" },
      admin
    ) as { id: string };
    let runs = tenantProvisioningRunAdapter.list!(db, runDef, {}, admin);
    expect(runs.records[0]?.data).toMatchObject({
      operation: "provision",
      status: "succeeded",
      tenant_id: created.id,
    });

    tenantAdminAdapter.actions!.deprovision(
      db,
      tenantDef,
      created.id,
      {},
      admin
    );
    runs = tenantProvisioningRunAdapter.list!(db, runDef, {}, admin);
    expect(runs.records[0]?.data).toMatchObject({
      operation: "deprovision",
      status: "succeeded",
      tenant_id: created.id,
    });
    expect(
      db.prepare(`SELECT id FROM tenants WHERE id=?`).get(created.id)
    ).toBeUndefined();
  });
});
