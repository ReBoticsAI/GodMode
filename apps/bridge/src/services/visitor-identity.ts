import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase, CoreUser } from "../core-db.js";
import { hashPassword } from "./auth/password.js";
import { createSession } from "./auth/session-store.js";
import { config } from "../config.js";
import {
  createTenantForUser,
  SYSTEM_USER_ID,
} from "./tenant-bootstrap.js";

/** Synthetic mailbox. Not deliverable, and it cannot collide with a real signup. */
export const VISITOR_EMAIL_DOMAIN = "visitors.godmode.invalid";

export class VisitorIdentityError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "VisitorIdentityError";
  }
}

export interface TemporaryVisitor {
  user: CoreUser;
  tenantId: string;
  sessionId: string;
}

export function isTemporaryUser(
  user: { id?: string; is_temporary?: number | null } | null | undefined
): boolean {
  if (!user?.id || user.id === SYSTEM_USER_ID) return false;
  return Number(user.is_temporary) === 1;
}

function uniqueVisitorSlug(core: CoreDatabase, userId: string): string {
  const stem = `visitor-${userId.replace(/-/g, "").slice(0, 12)}`;
  let slug = stem;
  let n = 0;
  while (true) {
    const row = core
      .prepare("SELECT id FROM tenants WHERE slug=?")
      .get(slug) as { id: string } | undefined;
    if (!row) return slug;
    n += 1;
    slug = `${stem}-${n}`;
  }
}

/**
 * First landing on the public Graph: a new user, a new non-operator workspace,
 * and a session. Never the install `system-local` user or the operator tenant.
 */
export function createTemporaryVisitor(
  core: CoreDatabase,
  ttlDays = config.auth.sessionTtlDays
): TemporaryVisitor {
  const id = uuidv4();
  const email = `visitor+${id}@${VISITOR_EMAIL_DOMAIN}`;
  core
    .prepare(
      `INSERT INTO users (
         id, email, display_name, avatar_url, is_admin, password_hash, is_temporary
       ) VALUES (?, ?, 'Visitor', NULL, 0, NULL, 1)`
    )
    .run(id, email);

  let tenantId: string;
  try {
    tenantId = createTenantForUser(
      core,
      id,
      "Personal",
      uniqueVisitorSlug(core, id)
    );
  } catch (err) {
    core.prepare("DELETE FROM users WHERE id=? AND is_temporary=1").run(id);
    throw err;
  }

  const tenant = core
    .prepare("SELECT is_operator, owner_user_id FROM tenants WHERE id=?")
    .get(tenantId) as { is_operator: number; owner_user_id: string } | undefined;
  if (!tenant || tenant.is_operator !== 0 || tenant.owner_user_id !== id) {
    throw new VisitorIdentityError(
      500,
      "Visitor workspace was not created as a personal tenant"
    );
  }

  const sessionId = createSession(core, id, ttlDays);
  const user = core.prepare("SELECT * FROM users WHERE id=?").get(id) as CoreUser;
  if (!isTemporaryUser(user) || user.id === SYSTEM_USER_ID) {
    throw new VisitorIdentityError(500, "Visitor account was not created");
  }
  return { user, tenantId, sessionId };
}

/**
 * Signup while a visitor session is current: same user id, same workspace.
 * An email that already belongs to someone else is rejected and nothing is merged.
 */
export function convertTemporaryVisitor(
  core: CoreDatabase,
  userId: string,
  input: { email: string; password: string; displayName?: string }
): CoreUser {
  if (userId === SYSTEM_USER_ID) {
    throw new VisitorIdentityError(400, "Cannot convert the install user");
  }
  const normalized = input.email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new VisitorIdentityError(400, "email required");
  }
  if (normalized.endsWith(`@${VISITOR_EMAIL_DOMAIN}`)) {
    throw new VisitorIdentityError(400, "email required");
  }
  if (!input.password || input.password.length < 6) {
    throw new VisitorIdentityError(400, "password must be at least 6 characters");
  }

  const current = core
    .prepare("SELECT * FROM users WHERE id=?")
    .get(userId) as CoreUser | undefined;
  if (!current || !isTemporaryUser(current)) {
    throw new VisitorIdentityError(404, "Visitor account not found");
  }

  const clash = core
    .prepare("SELECT id FROM users WHERE email=? AND id<>?")
    .get(normalized, userId) as { id: string } | undefined;
  if (clash) {
    throw new VisitorIdentityError(
      409,
      "An account with that email already exists"
    );
  }

  const displayName =
    input.displayName?.trim() || normalized.split("@")[0] || "User";
  const passwordHash = hashPassword(input.password);

  const updated = core
    .prepare(
      `UPDATE users
       SET email=?, display_name=?, password_hash=?, is_temporary=0,
           updated_at=datetime('now')
       WHERE id=? AND is_temporary=1`
    )
    .run(normalized, displayName, passwordHash, userId);
  if (updated.changes !== 1) {
    throw new VisitorIdentityError(409, "Visitor account could not be converted");
  }

  core
    .prepare(
      `UPDATE tenants
       SET name=?, updated_at=datetime('now')
       WHERE owner_user_id=? AND is_operator=0`
    )
    .run(`${displayName}'s Project`, userId);

  const user = core.prepare("SELECT * FROM users WHERE id=?").get(userId) as CoreUser;
  if (isTemporaryUser(user) || user.email !== normalized) {
    throw new VisitorIdentityError(500, "Visitor account was not converted");
  }
  return user;
}
