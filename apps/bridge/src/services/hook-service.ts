import { v4 as uuidv4 } from "uuid";
import {
  getCloudDb,
  type CoreDatabase,
  type CoreHook,
  type CoreHookRun,
  type HookActionKind,
  type HookOwnerKind,
  type HookTriggerKind,
} from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";

export class HookError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "HookError";
  }
}

export interface HookOwnerScope {
  /** The requesting user. */
  userId: string;
  /** The user's workspace tenant. */
  tenantId: string | null;
  /** Agent ids the user owns (owner_kind='agent' hooks they may manage). */
  agentIds: string[];
}

export interface CreateHookInput {
  ownerKind: HookOwnerKind;
  ownerId: string;
  ownerTenantId?: string | null;
  name: string;
  enabled?: boolean;
  triggerKind: HookTriggerKind;
  eventType?: string | null;
  scheduleCron?: string | null;
  conditionJson?: string | null;
  actionKind: HookActionKind;
  actionConfigJson?: string | null;
  rateLimitPerHour?: number | null;
  requireApproval?: boolean;
}

/** Workspace DB for a tenant (runs hooks Cloud→Workspace migrate on open). */
export function hookDbForTenant(tenantId: string): CoreDatabase {
  return getTenantDb(tenantId) as CoreDatabase;
}

export function listHookTenantIds(): string[] {
  return (
    getCloudDb()
      .prepare(`SELECT id FROM tenants`)
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
}

/** Workspace DB for a hook, or Cloud if orphan (`owner_tenant_id` is null). */
export function dbForHook(hook: {
  owner_tenant_id: string | null;
}): CoreDatabase {
  if (hook.owner_tenant_id) return hookDbForTenant(hook.owner_tenant_id);
  return getCloudDb();
}

function assertManageable(hook: CoreHook, scope: HookOwnerScope): void {
  const ownedByUser = hook.owner_kind === "user" && hook.owner_id === scope.userId;
  const ownedByAgent =
    hook.owner_kind === "agent" && scope.agentIds.includes(hook.owner_id);
  if (!ownedByUser && !ownedByAgent) {
    throw new HookError("Not allowed to manage this hook", 403);
  }
}

function ownershipSql(scope: HookOwnerScope): {
  clause: string;
  params: unknown[];
} {
  const agentPlaceholders = scope.agentIds.map(() => "?").join(",");
  const agentClause = scope.agentIds.length
    ? `OR (owner_kind = 'agent' AND owner_id IN (${agentPlaceholders}))`
    : "";
  return {
    clause: `(owner_kind = 'user' AND owner_id = ?) ${agentClause}`,
    params: [scope.userId, ...scope.agentIds],
  };
}

function queryOwnedHooks(db: CoreDatabase, scope: HookOwnerScope): CoreHook[] {
  const { clause, params } = ownershipSql(scope);
  return db
    .prepare(
      `SELECT * FROM hooks
       WHERE ${clause}
       ORDER BY created_at DESC`
    )
    .all(...params) as CoreHook[];
}

function mergeHooks(rows: CoreHook[]): CoreHook[] {
  const seen = new Set<string>();
  const out: CoreHook[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * List hooks the caller may manage.
 * Prefer the scope tenant workspace when set; otherwise fan-out all tenants
 * (plus Cloud orphans) and filter by ownership.
 */
export function listHooks(
  scope: HookOwnerScope,
  db?: CoreDatabase
): CoreHook[] {
  if (db) return queryOwnedHooks(db, scope);
  if (scope.tenantId) {
    return queryOwnedHooks(hookDbForTenant(scope.tenantId), scope);
  }
  const rows: CoreHook[] = [];
  for (const tenantId of listHookTenantIds()) {
    rows.push(...queryOwnedHooks(hookDbForTenant(tenantId), scope));
  }
  const { clause, params } = ownershipSql(scope);
  rows.push(
    ...(getCloudDb()
      .prepare(
        `SELECT * FROM hooks
         WHERE owner_tenant_id IS NULL AND (${clause})
         ORDER BY created_at DESC`
      )
      .all(...params) as CoreHook[])
  );
  return mergeHooks(rows);
}

function getHookOnDb(db: CoreDatabase, id: string): CoreHook | null {
  return (
    (db.prepare(`SELECT * FROM hooks WHERE id = ?`).get(id) as
      | CoreHook
      | undefined) ?? null
  );
}

/** Locate a hook row and the DB that owns it (workspace or Cloud orphan). */
export function findHookLocation(
  id: string,
  preferredDb?: CoreDatabase
): { hook: CoreHook; db: CoreDatabase } | null {
  if (preferredDb) {
    const hook = getHookOnDb(preferredDb, id);
    if (hook) return { hook, db: preferredDb };
  }
  for (const tenantId of listHookTenantIds()) {
    const db = hookDbForTenant(tenantId);
    const hook = getHookOnDb(db, id);
    if (hook) return { hook, db };
  }
  const cloud = getCloudDb();
  const orphan = getHookOnDb(cloud, id);
  if (orphan) return { hook: orphan, db: cloud };
  return null;
}

export function getHook(
  id: string,
  scope: HookOwnerScope,
  db?: CoreDatabase
): CoreHook {
  const found = findHookLocation(id, db);
  if (!found) throw new HookError("Hook not found", 404);
  assertManageable(found.hook, scope);
  return found.hook;
}

function resolveWriteDb(
  scope: HookOwnerScope,
  ownerTenantId: string | null,
  db?: CoreDatabase
): CoreDatabase {
  if (db) return db;
  if (ownerTenantId) return hookDbForTenant(ownerTenantId);
  if (scope.tenantId) return hookDbForTenant(scope.tenantId);
  return getCloudDb();
}

export function createHook(
  input: CreateHookInput,
  scope: HookOwnerScope,
  db?: CoreDatabase
): CoreHook {
  if (input.ownerKind === "user" && input.ownerId !== scope.userId) {
    throw new HookError("Cannot create a hook for another user", 403);
  }
  if (input.ownerKind === "agent" && !scope.agentIds.includes(input.ownerId)) {
    throw new HookError("Cannot create a hook for an agent you do not own", 403);
  }
  if (input.triggerKind === "event" && !input.eventType) {
    throw new HookError("event trigger requires eventType");
  }
  if (input.triggerKind === "schedule" && !input.scheduleCron) {
    throw new HookError("schedule trigger requires scheduleCron");
  }
  const ownerTenantId =
    input.ownerTenantId !== undefined
      ? input.ownerTenantId
      : (scope.tenantId ?? null);
  const workspace = resolveWriteDb(scope, ownerTenantId, db);
  const id = uuidv4();
  workspace
    .prepare(
      `INSERT INTO hooks
       (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
        trigger_kind, event_type, schedule_cron, condition_json,
        action_kind, action_config_json, rate_limit_per_hour, require_approval)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.ownerKind,
      input.ownerId,
      ownerTenantId,
      input.name,
      input.enabled === false ? 0 : 1,
      input.triggerKind,
      input.eventType ?? null,
      input.scheduleCron ?? null,
      input.conditionJson ?? null,
      input.actionKind,
      input.actionConfigJson ?? null,
      input.rateLimitPerHour ?? null,
      input.requireApproval ? 1 : 0
    );
  return workspace.prepare(`SELECT * FROM hooks WHERE id = ?`).get(id) as CoreHook;
}

const PATCHABLE: Record<string, string> = {
  name: "name",
  enabled: "enabled",
  triggerKind: "trigger_kind",
  eventType: "event_type",
  scheduleCron: "schedule_cron",
  conditionJson: "condition_json",
  actionKind: "action_kind",
  actionConfigJson: "action_config_json",
  rateLimitPerHour: "rate_limit_per_hour",
  requireApproval: "require_approval",
};

export function updateHook(
  id: string,
  patch: Record<string, unknown>,
  scope: HookOwnerScope,
  db?: CoreDatabase
): CoreHook {
  const found = findHookLocation(id, db);
  if (!found) throw new HookError("Hook not found", 404);
  assertManageable(found.hook, scope);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(PATCHABLE)) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === "enabled" || key === "requireApproval") {
      value = value ? 1 : 0;
    }
    sets.push(`${col} = ?`);
    values.push(value ?? null);
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    found.db
      .prepare(`UPDATE hooks SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values, id);
  }
  return found.db.prepare(`SELECT * FROM hooks WHERE id = ?`).get(id) as CoreHook;
}

export function deleteHook(
  id: string,
  scope: HookOwnerScope,
  db?: CoreDatabase
): void {
  const found = findHookLocation(id, db);
  if (!found) throw new HookError("Hook not found", 404);
  assertManageable(found.hook, scope);
  found.db.prepare(`DELETE FROM hooks WHERE id = ?`).run(id);
}

export function listHookRuns(
  hookId: string,
  scope: HookOwnerScope,
  db?: CoreDatabase
): CoreHookRun[] {
  const found = findHookLocation(hookId, db);
  if (!found) throw new HookError("Hook not found", 404);
  assertManageable(found.hook, scope);
  return found.db
    .prepare(
      `SELECT * FROM hook_runs WHERE hook_id = ? ORDER BY created_at DESC LIMIT 200`
    )
    .all(hookId) as CoreHookRun[];
}

/** Locate a hook_run and the DB that owns it. */
export function findHookRunLocation(
  runId: string,
  preferredDb?: CoreDatabase
): {
  run: { id: string; hook_id: string; status: string; event_id: string | null };
  db: CoreDatabase;
} | null {
  const select = `SELECT id, hook_id, status, event_id FROM hook_runs WHERE id = ?`;
  if (preferredDb) {
    const run = preferredDb.prepare(select).get(runId) as
      | {
          id: string;
          hook_id: string;
          status: string;
          event_id: string | null;
        }
      | undefined;
    if (run) return { run, db: preferredDb };
  }
  for (const tenantId of listHookTenantIds()) {
    const db = hookDbForTenant(tenantId);
    const run = db.prepare(select).get(runId) as
      | {
          id: string;
          hook_id: string;
          status: string;
          event_id: string | null;
        }
      | undefined;
    if (run) return { run, db };
  }
  const cloud = getCloudDb();
  const run = cloud.prepare(select).get(runId) as
    | {
        id: string;
        hook_id: string;
        status: string;
        event_id: string | null;
      }
    | undefined;
  if (run) return { run, db: cloud };
  return null;
}

/** Resolve a pending run's hook and verify the caller owns it. */
export function getHookForRun(
  runId: string,
  scope: HookOwnerScope,
  db?: CoreDatabase
): CoreHook {
  const found = findHookRunLocation(runId, db);
  if (!found) throw new HookError("Run not found", 404);
  return getHook(found.run.hook_id, scope, found.db);
}

/** All enabled schedule hooks across workspaces, plus Cloud orphans. */
export function listEnabledScheduleHooks(
  db?: CoreDatabase
): CoreHook[] {
  const sql = `SELECT * FROM hooks WHERE trigger_kind = 'schedule' AND enabled = 1`;
  if (db) return db.prepare(sql).all() as CoreHook[];
  const rows: CoreHook[] = [];
  const seen = new Set<string>();
  for (const tenantId of listHookTenantIds()) {
    for (const row of hookDbForTenant(tenantId).prepare(sql).all() as CoreHook[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  for (const row of getCloudDb()
    .prepare(
      `SELECT * FROM hooks
       WHERE trigger_kind = 'schedule' AND enabled = 1
         AND owner_tenant_id IS NULL`
    )
    .all() as CoreHook[]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}
