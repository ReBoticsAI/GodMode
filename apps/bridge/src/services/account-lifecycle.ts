import { randomUUID } from "node:crypto";
import type { CoreDatabase, CoreUser } from "../core-db.js";
import { getCloudDb } from "../core-db.js";
import { wipeWorkspaceTenant } from "./tenant-bootstrap.js";

export type DeletionRequestStatus =
  | "requested"
  | "canceled"
  | "fulfilled"
  | "rejected";

export type AccountDeletionRequest = {
  id: string;
  user_id: string;
  status: DeletionRequestStatus;
  reason: string | null;
  requested_at: string;
  fulfilled_at: string | null;
  fulfilled_by_user_id: string | null;
  notes: string | null;
};

/** Days after soft-delete before hard wipe of Cloud account + workspaces. */
export function accountRetentionDays(): number {
  const n = Number(process.env.SAAS_ACCOUNT_RETENTION_DAYS ?? "30");
  if (!Number.isFinite(n) || n < 0) return 30;
  return Math.floor(n);
}

export function writeLifecycleAudit(opts: {
  actorUserId?: string | null;
  action: string;
  targetUserId?: string | null;
  detail?: string | null;
}): void {
  try {
    getCloudDb()
      .prepare(
        `INSERT INTO saas_lifecycle_audit (actor_user_id, action, target_user_id, detail)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        opts.actorUserId ?? null,
        opts.action,
        opts.targetUserId ?? null,
        opts.detail ?? null
      );
  } catch (err) {
    console.warn(
      "[saas-lifecycle] audit insert failed:",
      err instanceof Error ? err.message : err
    );
  }
}

function invalidateUserSessions(core: CoreDatabase, userId: string): void {
  core.prepare(`DELETE FROM sessions WHERE user_id=?`).run(userId);
}

export function getPendingDeletionRequest(
  userId: string
): AccountDeletionRequest | undefined {
  return getCloudDb()
    .prepare(
      `SELECT * FROM account_deletion_requests
       WHERE user_id=? AND status='requested'
       ORDER BY datetime(requested_at) DESC
       LIMIT 1`
    )
    .get(userId) as AccountDeletionRequest | undefined;
}

export function requestAccountDeletion(
  userId: string,
  reason?: string | null
): AccountDeletionRequest {
  const core = getCloudDb();
  const user = core.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as
    | CoreUser
    | undefined;
  if (!user) {
    const err = new Error("User not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (user.is_admin) {
    const err = new Error(
      "Platform admin accounts cannot self-serve delete"
    ) as Error & { status: number };
    err.status = 400;
    throw err;
  }
  if (user.deleted_at) {
    const err = new Error("Account is already scheduled for deletion") as Error & {
      status: number;
    };
    err.status = 400;
    throw err;
  }
  const existing = getPendingDeletionRequest(userId);
  if (existing) return existing;

  const id = randomUUID();
  const trimmed = reason?.trim() || null;
  core
    .prepare(
      `INSERT INTO account_deletion_requests (id, user_id, status, reason)
       VALUES (?, ?, 'requested', ?)`
    )
    .run(id, userId, trimmed);
  writeLifecycleAudit({
    actorUserId: userId,
    action: "account.deletion_requested",
    targetUserId: userId,
    detail: trimmed,
  });
  softDeleteUserAccount({
    userId,
    actorUserId: userId,
    reason:
      trimmed ||
      "Account deletion requested. Data will be removed after the retention window.",
    requestId: id,
    allowSelfServe: true,
  });
  return core
    .prepare(`SELECT * FROM account_deletion_requests WHERE id=?`)
    .get(id) as AccountDeletionRequest;
}

export function cancelAccountDeletion(userId: string): AccountDeletionRequest | null {
  const pending = getPendingDeletionRequest(userId);
  if (!pending) return null;
  const core = getCloudDb();
  core
    .prepare(
      `UPDATE account_deletion_requests
       SET status='canceled'
       WHERE id=? AND status='requested'`
    )
    .run(pending.id);
  writeLifecycleAudit({
    actorUserId: userId,
    action: "account.deletion_canceled",
    targetUserId: userId,
  });
  return core
    .prepare(`SELECT * FROM account_deletion_requests WHERE id=?`)
    .get(pending.id) as AccountDeletionRequest;
}

export function listDeletionRequests(status?: DeletionRequestStatus): Array<
  AccountDeletionRequest & { email: string | null; display_name: string | null }
> {
  const core = getCloudDb();
  if (status) {
    return core
      .prepare(
        `SELECT r.*, u.email AS email, u.display_name AS display_name
         FROM account_deletion_requests r
         LEFT JOIN users u ON u.id = r.user_id
         WHERE r.status=?
         ORDER BY datetime(r.requested_at) DESC`
      )
      .all(status) as Array<
      AccountDeletionRequest & { email: string | null; display_name: string | null }
    >;
  }
  return core
    .prepare(
      `SELECT r.*, u.email AS email, u.display_name AS display_name
       FROM account_deletion_requests r
       LEFT JOIN users u ON u.id = r.user_id
       ORDER BY datetime(r.requested_at) DESC
       LIMIT 200`
    )
    .all() as Array<
    AccountDeletionRequest & { email: string | null; display_name: string | null }
  >;
}

/** Soft-delete: block login, keep data until retention hard wipe. */
export function softDeleteUserAccount(opts: {
  userId: string;
  actorUserId: string;
  reason?: string | null;
  requestId?: string | null;
  /** Allow the account owner to soft-delete themselves (self-serve). */
  allowSelfServe?: boolean;
}): CoreUser {
  const core = getCloudDb();
  const user = core.prepare(`SELECT * FROM users WHERE id=?`).get(opts.userId) as
    | CoreUser
    | undefined;
  if (!user) {
    const err = new Error("User not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (user.is_admin) {
    const err = new Error("Cannot soft-delete a platform admin") as Error & {
      status: number;
    };
    err.status = 400;
    throw err;
  }
  if (opts.userId === opts.actorUserId && !opts.allowSelfServe) {
    const err = new Error("Admin cannot fulfill their own deletion") as Error & {
      status: number;
    };
    err.status = 400;
    throw err;
  }

  const reason =
    opts.reason?.trim() ||
    "Account deletion requested. Data will be removed after the retention window.";

  core
    .prepare(
      `UPDATE users SET
         deleted_at=datetime('now'),
         deletion_status='pending_wipe',
         access_disabled=1,
         access_disabled_reason=?,
         updated_at=datetime('now')
       WHERE id=?`
    )
    .run(reason, opts.userId);
  invalidateUserSessions(core, opts.userId);

  if (opts.requestId) {
    core
      .prepare(
        `UPDATE account_deletion_requests
         SET status='fulfilled', fulfilled_at=datetime('now'), fulfilled_by_user_id=?
         WHERE id=?`
      )
      .run(opts.actorUserId, opts.requestId);
  }

  writeLifecycleAudit({
    actorUserId: opts.actorUserId,
    action: "account.soft_delete",
    targetUserId: opts.userId,
    detail: reason,
  });

  return core.prepare(`SELECT * FROM users WHERE id=?`).get(opts.userId) as CoreUser;
}

export function fulfillDeletionRequest(
  requestId: string,
  actorUserId: string
): CoreUser {
  const core = getCloudDb();
  const row = core
    .prepare(`SELECT * FROM account_deletion_requests WHERE id=?`)
    .get(requestId) as AccountDeletionRequest | undefined;
  if (!row) {
    const err = new Error("Deletion request not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (row.status !== "requested") {
    const err = new Error(`Request is already ${row.status}`) as Error & {
      status: number;
    };
    err.status = 400;
    throw err;
  }
  return softDeleteUserAccount({
    userId: row.user_id,
    actorUserId,
    reason: row.reason,
    requestId: row.id,
  });
}

/**
 * Hard wipe soft-deleted account after retention. Audited.
 * Does not allow wiping admins or operator-tenant owners.
 */
export function hardWipeUserAccount(
  userId: string,
  actorUserId: string | null
): void {
  const core = getCloudDb();
  const user = core.prepare(`SELECT * FROM users WHERE id=?`).get(userId) as
    | CoreUser
    | undefined;
  if (!user) return;
  if (user.is_admin) {
    throw new Error("Refusing to hard-wipe platform admin");
  }

  const owned = core
    .prepare(`SELECT id, is_operator FROM tenants WHERE owner_user_id=?`)
    .all(userId) as Array<{ id: string; is_operator: number }>;
  for (const t of owned) {
    if (t.is_operator) {
      throw new Error(
        "Cannot wipe a user who owns the operator tenant; transfer ownership first"
      );
    }
    wipeWorkspaceTenant(core, t.id);
  }

  core
    .prepare(
      `UPDATE saas_subscriptions SET user_id=NULL, updated_at=datetime('now') WHERE user_id=?`
    )
    .run(userId);
  core.prepare(`DELETE FROM account_deletion_requests WHERE user_id=?`).run(userId);
  invalidateUserSessions(core, userId);
  core.prepare(`DELETE FROM users WHERE id=?`).run(userId);

  writeLifecycleAudit({
    actorUserId,
    action: "account.hard_delete",
    targetUserId: userId,
    detail: `retention_days=${accountRetentionDays()}`,
  });
}

export function runAccountRetentionPass(): number {
  const days = accountRetentionDays();
  const core = getCloudDb();
  const due = core
    .prepare(
      `SELECT id FROM users
       WHERE deletion_status='pending_wipe'
         AND deleted_at IS NOT NULL
         AND deleted_at < datetime('now', ?)
       LIMIT 50`
    )
    .all(`-${days} days`) as Array<{ id: string }>;

  let wiped = 0;
  for (const row of due) {
    try {
      hardWipeUserAccount(row.id, null);
      wiped += 1;
    } catch (err) {
      console.warn(
        `[saas-lifecycle] hard wipe failed for ${row.id}:`,
        err instanceof Error ? err.message : err
      );
      writeLifecycleAudit({
        action: "account.hard_delete_failed",
        targetUserId: row.id,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (wiped > 0) {
    console.log(`[saas-lifecycle] hard-wiped ${wiped} account(s) after retention`);
  }
  return wiped;
}

const ACCOUNT_RETENTION_INTERVAL_MS = Number(
  process.env.SAAS_ACCOUNT_RETENTION_INTERVAL_MS ?? 60 * 60 * 1000
);

export function startAccountRetentionScheduler(): () => void {
  const run = () => {
    try {
      runAccountRetentionPass();
    } catch (err) {
      console.warn(
        "[saas-lifecycle] retention pass failed:",
        err instanceof Error ? err.message : err
      );
    }
  };
  run();
  const timer = setInterval(run, ACCOUNT_RETENTION_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
