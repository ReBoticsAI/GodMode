import { v4 as uuidv4 } from "uuid";
import {
  getCoreDb,
  type CoreDatabase,
  type CoreHook,
  type CoreHookRun,
  type HookActionKind,
  type HookOwnerKind,
  type HookTriggerKind,
} from "../core-db.js";

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

function assertManageable(hook: CoreHook, scope: HookOwnerScope): void {
  const ownedByUser = hook.owner_kind === "user" && hook.owner_id === scope.userId;
  const ownedByAgent =
    hook.owner_kind === "agent" && scope.agentIds.includes(hook.owner_id);
  if (!ownedByUser && !ownedByAgent) {
    throw new HookError("Not allowed to manage this hook", 403);
  }
}

export function listHooks(
  scope: HookOwnerScope,
  db: CoreDatabase = getCoreDb()
): CoreHook[] {
  const agentPlaceholders = scope.agentIds.map(() => "?").join(",");
  const agentClause = scope.agentIds.length
    ? `OR (owner_kind = 'agent' AND owner_id IN (${agentPlaceholders}))`
    : "";
  return db
    .prepare(
      `SELECT * FROM hooks
       WHERE (owner_kind = 'user' AND owner_id = ?) ${agentClause}
       ORDER BY created_at DESC`
    )
    .all(scope.userId, ...scope.agentIds) as CoreHook[];
}

export function getHook(
  id: string,
  scope: HookOwnerScope,
  db: CoreDatabase = getCoreDb()
): CoreHook {
  const hook = db.prepare(`SELECT * FROM hooks WHERE id = ?`).get(id) as
    | CoreHook
    | undefined;
  if (!hook) throw new HookError("Hook not found", 404);
  assertManageable(hook, scope);
  return hook;
}

export function createHook(
  input: CreateHookInput,
  scope: HookOwnerScope,
  db: CoreDatabase = getCoreDb()
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
  const id = uuidv4();
  db.prepare(
    `INSERT INTO hooks
       (id, owner_kind, owner_id, owner_tenant_id, name, enabled,
        trigger_kind, event_type, schedule_cron, condition_json,
        action_kind, action_config_json, rate_limit_per_hour, require_approval)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.ownerKind,
    input.ownerId,
    input.ownerTenantId ?? scope.tenantId ?? null,
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
  return db.prepare(`SELECT * FROM hooks WHERE id = ?`).get(id) as CoreHook;
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
  db: CoreDatabase = getCoreDb()
): CoreHook {
  getHook(id, scope, db);
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
    db.prepare(`UPDATE hooks SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }
  return db.prepare(`SELECT * FROM hooks WHERE id = ?`).get(id) as CoreHook;
}

export function deleteHook(
  id: string,
  scope: HookOwnerScope,
  db: CoreDatabase = getCoreDb()
): void {
  getHook(id, scope, db);
  db.prepare(`DELETE FROM hooks WHERE id = ?`).run(id);
}

export function listHookRuns(
  hookId: string,
  scope: HookOwnerScope,
  db: CoreDatabase = getCoreDb()
): CoreHookRun[] {
  getHook(hookId, scope, db);
  return db
    .prepare(
      `SELECT * FROM hook_runs WHERE hook_id = ? ORDER BY created_at DESC LIMIT 200`
    )
    .all(hookId) as CoreHookRun[];
}

/** Resolve a pending run's hook and verify the caller owns it. */
export function getHookForRun(
  runId: string,
  scope: HookOwnerScope,
  db: CoreDatabase = getCoreDb()
): CoreHook {
  const run = db
    .prepare(`SELECT hook_id FROM hook_runs WHERE id = ?`)
    .get(runId) as { hook_id: string } | undefined;
  if (!run) throw new HookError("Run not found", 404);
  return getHook(run.hook_id, scope, db);
}

/** All enabled schedule hooks (used by the scheduler at boot / refresh). */
export function listEnabledScheduleHooks(
  db: CoreDatabase = getCoreDb()
): CoreHook[] {
  return db
    .prepare(
      `SELECT * FROM hooks WHERE trigger_kind = 'schedule' AND enabled = 1`
    )
    .all() as CoreHook[];
}
