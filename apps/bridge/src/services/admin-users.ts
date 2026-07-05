import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase, CoreUser } from "../core-db.js";
import { hashPassword } from "./auth/password.js";
import { slugFromEmail } from "./auth/session-store.js";
import {
  createTenantForUser,
  listUserTenants,
  wipeWorkspaceTenant,
} from "./tenant-bootstrap.js";

const SYSTEM_USER_ID = "system-local";

export interface AdminUserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
  tenants: ReturnType<typeof listUserTenants>;
}

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSlug(core: CoreDatabase, base: string, excludeTenantId?: string): string {
  const stem = normalizeSlug(base) || "workspace";
  let slug = stem;
  let n = 0;
  while (true) {
    const row = core
      .prepare("SELECT id FROM tenants WHERE slug=?")
      .get(slug) as { id: string } | undefined;
    if (!row || row.id === excludeTenantId) return slug;
    n += 1;
    slug = `${stem}-${n}`;
  }
}

function rowToAdminUser(core: CoreDatabase, u: CoreUser): AdminUserDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    isAdmin: Boolean(u.is_admin),
    createdAt: u.created_at,
    tenants: listUserTenants(core, u.id),
  };
}

export function listAdminUsers(core: CoreDatabase): AdminUserDto[] {
  const rows = core
    .prepare(
      `SELECT * FROM users
       WHERE id <> ?
       ORDER BY is_admin DESC, created_at`
    )
    .all(SYSTEM_USER_ID) as CoreUser[];
  return rows.map((u) => rowToAdminUser(core, u));
}

export function getAdminUser(core: CoreDatabase, userId: string): AdminUserDto | null {
  const user = core.prepare("SELECT * FROM users WHERE id=?").get(userId) as
    | CoreUser
    | undefined;
  if (!user || user.id === SYSTEM_USER_ID) return null;
  return rowToAdminUser(core, user);
}

export function createAdminUser(
  core: CoreDatabase,
  input: {
    email: string;
    password: string;
    displayName?: string;
    isAdmin?: boolean;
    provisionDefaultTenant?: boolean;
  }
): AdminUserDto {
  const normalized = input.email.trim().toLowerCase();
  if (!normalized) throw new AdminUsersError(400, "email required");
  if (!input.password || input.password.length < 6) {
    throw new AdminUsersError(400, "password must be at least 6 characters");
  }

  const existing = core
    .prepare("SELECT id FROM users WHERE email=?")
    .get(normalized) as { id: string } | undefined;
  if (existing) {
    throw new AdminUsersError(409, "An account with that email already exists");
  }

  const displayName =
    input.displayName?.trim() || normalized.split("@")[0] || "User";
  const id = uuidv4();
  core.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, is_admin, password_hash)
     VALUES (?, ?, ?, NULL, ?, ?)`
  ).run(id, normalized, displayName, input.isAdmin ? 1 : 0, hashPassword(input.password));
  core.prepare(
    `INSERT OR IGNORE INTO credit_wallets (user_id, balance) VALUES (?, 100)`
  ).run(id);

  if (input.provisionDefaultTenant !== false) {
    const slug = uniqueSlug(core, slugFromEmail(normalized));
    createTenantForUser(core, id, `${displayName}'s Project`, slug);
  }

  const user = core.prepare("SELECT * FROM users WHERE id=?").get(id) as CoreUser;
  return rowToAdminUser(core, user);
}

export function updateAdminUser(
  core: CoreDatabase,
  userId: string,
  input: {
    email?: string;
    displayName?: string;
    isAdmin?: boolean;
    password?: string;
  }
): AdminUserDto {
  const user = core.prepare("SELECT * FROM users WHERE id=?").get(userId) as
    | CoreUser
    | undefined;
  if (!user || user.id === SYSTEM_USER_ID) {
    throw new AdminUsersError(404, "User not found");
  }

  const email =
    input.email !== undefined ? input.email.trim().toLowerCase() : user.email;
  if (!email) throw new AdminUsersError(400, "email required");

  if (email !== user.email) {
    const clash = core
      .prepare("SELECT id FROM users WHERE email=? AND id<>?")
      .get(email, userId) as { id: string } | undefined;
    if (clash) throw new AdminUsersError(409, "Email already in use");
  }

  const displayName =
    input.displayName !== undefined
      ? input.displayName.trim() || email.split("@")[0]
      : user.display_name;

  if (input.password !== undefined) {
    if (!input.password || input.password.length < 6) {
      throw new AdminUsersError(400, "password must be at least 6 characters");
    }
    core.prepare(
      `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`
    ).run(hashPassword(input.password), userId);
  }

  core.prepare(
    `UPDATE users SET email=?, display_name=?, is_admin=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    email,
    displayName,
    input.isAdmin !== undefined ? (input.isAdmin ? 1 : 0) : user.is_admin,
    userId
  );

  const updated = core.prepare("SELECT * FROM users WHERE id=?").get(userId) as CoreUser;
  return rowToAdminUser(core, updated);
}

export function deleteAdminUser(
  core: CoreDatabase,
  userId: string,
  actorUserId: string
): void {
  if (userId === SYSTEM_USER_ID) {
    throw new AdminUsersError(400, "Cannot delete system user");
  }
  if (userId === actorUserId) {
    throw new AdminUsersError(400, "Cannot delete your own account");
  }

  const user = core.prepare("SELECT id FROM users WHERE id=?").get(userId) as
    | { id: string }
    | undefined;
  if (!user) throw new AdminUsersError(404, "User not found");

  const owned = core
    .prepare(`SELECT id, is_operator FROM tenants WHERE owner_user_id=?`)
    .all(userId) as Array<{ id: string; is_operator: number }>;

  for (const t of owned) {
    if (t.is_operator) {
      throw new AdminUsersError(
        400,
        "Cannot delete a user who owns the operator tenant; transfer ownership first"
      );
    }
    wipeWorkspaceTenant(core, t.id);
  }

  core.prepare(`DELETE FROM users WHERE id=?`).run(userId);
}

export function createAdminTenantForUser(
  core: CoreDatabase,
  userId: string,
  name: string,
  slug?: string
): { id: string; name: string; slug: string } {
  const user = core.prepare("SELECT email FROM users WHERE id=?").get(userId) as
    | { email: string }
    | undefined;
  if (!user) throw new AdminUsersError(404, "User not found");

  const trimmed = name.trim();
  if (!trimmed) throw new AdminUsersError(400, "name required");

  const tenantSlug = uniqueSlug(
    core,
    slug?.trim() ? slug : slugFromEmail(user.email)
  );
  const tenantId = createTenantForUser(core, userId, trimmed, tenantSlug);
  return { id: tenantId, name: trimmed, slug: tenantSlug };
}

export function updateAdminTenant(
  core: CoreDatabase,
  tenantId: string,
  input: { name?: string; slug?: string }
): { id: string; name: string; slug: string; isOperator: boolean } {
  const row = core
    .prepare(`SELECT id, name, slug, is_operator FROM tenants WHERE id=?`)
    .get(tenantId) as
    | { id: string; name: string; slug: string; is_operator: number }
    | undefined;
  if (!row) throw new AdminUsersError(404, "Tenant not found");

  const name =
    input.name !== undefined ? input.name.trim() : row.name;
  if (!name) throw new AdminUsersError(400, "name required");

  let slug = row.slug;
  if (input.slug !== undefined) {
    slug = uniqueSlug(core, input.slug, tenantId);
  }

  core.prepare(
    `UPDATE tenants SET name=?, slug=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, slug, tenantId);

  return {
    id: tenantId,
    name,
    slug,
    isOperator: Boolean(row.is_operator),
  };
}

export function deleteAdminTenant(core: CoreDatabase, tenantId: string): void {
  const row = core
    .prepare(`SELECT is_operator FROM tenants WHERE id=?`)
    .get(tenantId) as { is_operator: number } | undefined;
  if (!row) throw new AdminUsersError(404, "Tenant not found");
  if (row.is_operator) {
    throw new AdminUsersError(400, "Cannot delete the operator tenant");
  }
  wipeWorkspaceTenant(core, tenantId);
}

export class AdminUsersError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "AdminUsersError";
  }
}
