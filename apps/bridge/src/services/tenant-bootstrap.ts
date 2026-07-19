import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import {
  getCoreDb,
  getOperatorTenantId,
  getPlatformMeta,
  setPlatformMeta,
  type CoreDatabase,
  type CoreUser,
  type MembershipRole,
} from "../core-db.js";
import { migrateTenantDb } from "../db.js";
import Database from "better-sqlite3";
import { configureDbPragmas } from "./db-config.js";
import { ensureBuiltInStructure } from "./structure.js";
import { slugFromEmail } from "./auth/session-store.js";
import { hashPassword } from "./auth/password.js";
import { getTenantDb, evictTenantDb } from "../tenant-registry.js";
import { seedIntelligenceAgent, ensureAgentReflectionDefaults } from "./agents/agents-db.js";
import { seedPersonalOsForNewTenant } from "./personal-os-seed.js";
import { ensureWelcomeWikiPage } from "./welcome-wiki.js";

const SYSTEM_USER_ID = "system-local";
const DEFAULT_TENANT_SLUG = "default";

/** One-time migration: platform.db → first operator tenant + system user. */
export function ensurePlatformBootstrap(): {
  operatorTenantId: string;
  systemUserId: string;
} {
  const core = getCoreDb();
  const migrated = getPlatformMeta(core, "tenant_bootstrap_v1");
  if (migrated === "done") {
    const operatorId = getOperatorTenantId(core);
    if (!operatorId) throw new Error("Bootstrap marked done but no operator tenant");
    return { operatorTenantId: operatorId, systemUserId: SYSTEM_USER_ID };
  }

  fs.mkdirSync(config.tenantsDir, { recursive: true });

  const systemUser = upsertSystemUser(core);
  const tenantId = uuidv4();
  const tenantPath = path.join(config.tenantsDir, `${tenantId}.sqlite`);

  if (fs.existsSync(config.dbPath)) {
    fs.copyFileSync(config.dbPath, tenantPath);
    console.log(`[bootstrap] Copied legacy ${config.dbPath} → tenant ${tenantId}`);
  } else {
    const db = new Database(tenantPath);
    configureDbPragmas(db);
    migrateTenantDb(db);
    ensureBuiltInStructure(db);
    db.close();
    console.log(`[bootstrap] Created fresh tenant DB ${tenantId}`);
  }

  core.prepare(
    `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
     VALUES (?, ?, ?, 1, ?)`
  ).run(tenantId, "Default Project", DEFAULT_TENANT_SLUG, systemUser.id);

  core.prepare(
    `INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES (?, ?, 'owner')`
  ).run(systemUser.id, tenantId);

  core.prepare(
    `INSERT OR IGNORE INTO credit_wallets (user_id, balance) VALUES (?, 1000)`
  ).run(systemUser.id);

  setPlatformMeta(core, "tenant_bootstrap_v1", "done");
  setPlatformMeta(core, "legacy_db_path", config.dbPath);

  return { operatorTenantId: tenantId, systemUserId: systemUser.id };
}

function upsertSystemUser(core: CoreDatabase): CoreUser {
  const existing = core
    .prepare("SELECT * FROM users WHERE id=?")
    .get(SYSTEM_USER_ID) as CoreUser | undefined;
  if (existing) return existing;

  core.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, is_admin)
     VALUES (?, ?, ?, NULL, 0)`
  ).run(SYSTEM_USER_ID, "local@godmode.platform", "Local User");

  return core
    .prepare("SELECT * FROM users WHERE id=?")
    .get(SYSTEM_USER_ID) as CoreUser;
}

export function createTenantForUser(
  core: CoreDatabase,
  userId: string,
  name: string,
  slug: string
): string {
  const tenantId = uuidv4();
  const tenantPath = path.join(config.tenantsDir, `${tenantId}.sqlite`);
  const db = new Database(tenantPath);
  configureDbPragmas(db);
  migrateTenantDb(db);
  // Regular user workspaces: personal OS seed only — not operator Trading plugins.
  seedIntelligenceAgent(db);
  ensureAgentReflectionDefaults(db);
  seedPersonalOsForNewTenant(db);
  db.close();

  core.prepare(
    `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
     VALUES (?, ?, ?, 0, ?)`
  ).run(tenantId, name, slug, userId);

  core.prepare(
    `INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES (?, ?, 'owner')`
  ).run(userId, tenantId);

  core.prepare(
    `INSERT OR IGNORE INTO credit_wallets (user_id, balance) VALUES (?, 100)`
  ).run(userId);

  ensureWelcomeWikiPage(core, tenantId, userId);

  return tenantId;
}

export function listUserTenants(
  core: CoreDatabase,
  userId: string
): Array<{ id: string; name: string; slug: string; role: MembershipRole; is_operator: number }> {
  return core
    .prepare(
      `SELECT t.id, t.name, t.slug, t.is_operator, m.role
       FROM tenant_memberships m
       JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id=?
       ORDER BY t.is_operator ASC, t.name`
    )
    .all(userId) as Array<{
    id: string;
    name: string;
    slug: string;
    role: MembershipRole;
    is_operator: number;
  }>;
}

export function userHasTenantAccess(
  core: CoreDatabase,
  userId: string,
  tenantId: string
): MembershipRole | null {
  const row = core
    .prepare(
      `SELECT role FROM tenant_memberships WHERE user_id=? AND tenant_id=?`
    )
    .get(userId, tenantId) as { role: MembershipRole } | undefined;
  return row?.role ?? null;
}

function upsertAdminUser(
  core: CoreDatabase,
  email: string,
  displayName: string
): CoreUser {
  const normalized = email.toLowerCase();
  let user = core
    .prepare("SELECT * FROM users WHERE email=?")
    .get(normalized) as CoreUser | undefined;

  if (user) {
    core.prepare(
      `UPDATE users SET display_name=?, is_admin=1,
         email_verified_at=COALESCE(email_verified_at, datetime('now')),
         updated_at=datetime('now') WHERE id=?`
    ).run(displayName, user.id);
    // Seed the default password only when one is not already set (idempotent;
    // never clobber a password the user may have changed).
    const seedPwd = config.auth.initialAdminPassword.trim();
    if (seedPwd && !user.password_hash && !config.isHub) {
      core.prepare(
        `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`
      ).run(hashPassword(seedPwd), user.id);
    }
  } else {
    const id = uuidv4();
    const seedPwd = config.auth.initialAdminPassword.trim();
    const passwordHash = config.isHub || !seedPwd ? null : hashPassword(seedPwd);
    core.prepare(
      `INSERT INTO users (id, email, display_name, avatar_url, is_admin, password_hash, email_verified_at)
       VALUES (?, ?, ?, NULL, 1, ?, datetime('now'))`
    ).run(id, normalized, displayName, passwordHash);
    core.prepare(
      `INSERT OR IGNORE INTO credit_wallets (user_id, balance) VALUES (?, 1000)`
    ).run(id);
    user = core.prepare("SELECT * FROM users WHERE id=?").get(id) as CoreUser;
  }

  return core.prepare("SELECT * FROM users WHERE id=?").get(user!.id) as CoreUser;
}

/** One-time seed: platform admins + operator tenant ownership. */
export function ensureInitialAdmins(core: CoreDatabase): void {
  if (getPlatformMeta(core, "initial_admins_v1") === "done") return;

  const admins = config.auth.initialAdmins;
  if (admins.length === 0) {
    setPlatformMeta(core, "initial_admins_v1", "done");
    return;
  }

  const operatorTenantId = getOperatorTenantId(core);
  if (!operatorTenantId) {
    console.warn("[bootstrap] No operator tenant; skipping initial admin seed");
    return;
  }

  const [primary, ...rest] = admins;
  const primaryUser = upsertAdminUser(core, primary.email, primary.name);

  core.prepare(
    `UPDATE tenants SET owner_user_id=?, name=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(primaryUser.id, `${primary.name}'s Project`, operatorTenantId);

  core.prepare(
    `INSERT INTO tenant_memberships (user_id, tenant_id, role)
     VALUES (?, ?, 'owner')
     ON CONFLICT(user_id, tenant_id) DO UPDATE SET role='owner'`
  ).run(primaryUser.id, operatorTenantId);

  console.log(
    `[bootstrap] Operator tenant ${operatorTenantId} assigned to ${primary.name} (${primary.email})`
  );

  for (const admin of rest) {
    const user = upsertAdminUser(core, admin.email, admin.name);
    const existing = core
      .prepare(
        `SELECT t.id FROM tenants t
         WHERE t.owner_user_id=? AND t.is_operator=0 LIMIT 1`
      )
      .get(user.id) as { id: string } | undefined;

    if (!existing) {
      const slug = slugFromEmail(admin.email);
      createTenantForUser(core, user.id, `${admin.name}'s Project`, slug);
      console.log(`[bootstrap] Created workspace for ${admin.name} (${admin.email})`);
    }
  }

  setPlatformMeta(core, "initial_admins_v1", "done");
}

/**
 * Promote the first real signup to platform admin when INITIAL_ADMINS is empty.
 * Idempotent — guarded by platform meta and existing admin rows.
 */
export function promoteFirstSignupAdmin(core: CoreDatabase, userId: string): boolean {
  if (config.auth.initialAdmins.length > 0) return false;
  if (getPlatformMeta(core, "first_admin_assigned_v1") === "done") return false;

  const adminCount = (
    core
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE is_admin=1 AND id <> ?`)
      .get(SYSTEM_USER_ID) as { c: number }
  ).c;
  if (adminCount > 0) return false;

  const user = core
    .prepare(`SELECT * FROM users WHERE id=?`)
    .get(userId) as CoreUser | undefined;
  if (!user || user.id === SYSTEM_USER_ID) return false;

  const operatorTenantId = getOperatorTenantId(core);
  if (!operatorTenantId) return false;

  core.prepare(
    `UPDATE users SET is_admin=1, updated_at=datetime('now') WHERE id=?`
  ).run(userId);

  core.prepare(
    `UPDATE tenants SET owner_user_id=?, name=?, updated_at=datetime('now') WHERE id=?`
  ).run(userId, `${user.display_name}'s Project`, operatorTenantId);

  core.prepare(
    `INSERT INTO tenant_memberships (user_id, tenant_id, role)
     VALUES (?, ?, 'owner')
     ON CONFLICT(user_id, tenant_id) DO UPDATE SET role='owner'`
  ).run(userId, operatorTenantId);

  setPlatformMeta(core, "first_admin_assigned_v1", "done");
  console.log(
    `[auth] First signup promoted to platform admin: ${user.display_name} (${user.email})`
  );
  return true;
}

/**
 * One-time repair: non-operator tenants were incorrectly seeded with the
 * operator's built-in department tree. Clear structure so new users see an
 * empty Agents section and only resources shared with them.
 */
export function repairNonOperatorTenantStructure(core: CoreDatabase): void {
  if (getPlatformMeta(core, "repair_user_tenant_structure_v1") === "done") return;

  const rows = core
    .prepare(`SELECT id FROM tenants WHERE is_operator=0`)
    .all() as Array<{ id: string }>;

  for (const { id } of rows) {
    try {
      const db = getTenantDb(id);
      db.exec(`
        DELETE FROM structure_nodes;
        DELETE FROM division_pages;
        DELETE FROM divisions;
        DELETE FROM departments;
      `);
      console.log(`[bootstrap] Cleared seeded structure from user tenant ${id}`);
    } catch (err) {
      console.warn(
        `[bootstrap] Could not clear structure for tenant ${id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  setPlatformMeta(core, "repair_user_tenant_structure_v1", "done");
}

/**
 * One-time: remove the legacy Life department seeded on early personal-OS tenants.
 */
export function removeLegacyLifeDepartmentFromPersonalTenants(
  core: CoreDatabase
): void {
  if (getPlatformMeta(core, "remove_personal_os_life_dept_v1") === "done") return;

  const rows = core
    .prepare(`SELECT id FROM tenants WHERE is_operator=0`)
    .all() as Array<{ id: string }>;

  for (const { id } of rows) {
    try {
      const db = getTenantDb(id);
      db.prepare(`DELETE FROM structure_nodes WHERE id = 'life' OR parent_id = 'life'`).run();
    } catch {
      /* skip */
    }
  }

  setPlatformMeta(core, "remove_personal_os_life_dept_v1", "done");
}

/**
 * Delete every trace of a non-operator workspace tenant: its SQLite file (plus
 * WAL/SHM sidecars), memberships, share grants it owns or receives, and the
 * `tenants` row. The cached DB handle is evicted first so the file is not held
 * open (Windows would otherwise refuse the unlink). Never call on the operator
 * tenant — caller guards with `is_operator=0`.
 */
export function wipeWorkspaceTenant(core: CoreDatabase, tenantId: string): void {
  // Drop the cached/open handle so the file is unlocked before deletion.
  evictTenantDb(tenantId);

  const base = path.join(config.tenantsDir, `${tenantId}.sqlite`);
  for (const file of [base, `${base}-wal`, `${base}-shm`]) {
    try {
      if (fs.existsSync(file)) fs.rmSync(file);
    } catch (err) {
      console.warn(
        `[bootstrap] Could not delete tenant file ${file}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  core.prepare(`DELETE FROM tenant_memberships WHERE tenant_id=?`).run(tenantId);
  core
    .prepare(
      `DELETE FROM share_grants WHERE owner_tenant_id=? OR grantee_tenant_id=?`
    )
    .run(tenantId, tenantId);
  // Orphan local SC/federation connection rows for this tenant.
  try {
    core.prepare(`DELETE FROM bridge_connections WHERE owner_tenant_id=?`).run(tenantId);
  } catch {
    /* table may not exist on very old DBs */
  }
  core.prepare(`DELETE FROM tenants WHERE id=? AND is_operator=0`).run(tenantId);
}

export { SYSTEM_USER_ID, DEFAULT_TENANT_SLUG };
