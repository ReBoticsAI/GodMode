/**
 * Run GodMode Automations against coding write/shell tools (#448).
 * Disk IDE hooks.json remains discovery/compat only.
 */
import { v4 as uuidv4 } from "uuid";
import {
  getCloudDb,
  type CoreDatabase,
  type CoreEvent,
  type CoreHook,
} from "../../core-db.js";
import {
  eventTypeMatches,
  executeHook,
  ownerCanSeeEvent,
} from "../hook-dispatcher.js";

export function codingHookExecutionEnabled(): boolean {
  const raw = process.env.CODING_HOOK_EXECUTION?.trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0") return false;
  return true;
}

function failClosedWebhook(hook: CoreHook): boolean {
  if (hook.action_kind !== "webhook") return false;
  if (!hook.action_config_json) return false;
  try {
    const cfg = JSON.parse(hook.action_config_json) as { failClosed?: unknown };
    return cfg.failClosed === true || cfg.failClosed === "true";
  } catch {
    return false;
  }
}

export async function assertCodingHooksAllow(opts: {
  eventType: string;
  tenantId?: string | null;
  actorKind: "user" | "agent" | "system";
  actorId?: string | null;
  payload?: Record<string, unknown>;
  db?: CoreDatabase;
}): Promise<void> {
  if (!codingHookExecutionEnabled()) return;
  const db = opts.db ?? getCloudDb();
  const event: CoreEvent = {
    id: `pre-${uuidv4()}`,
    type: opts.eventType,
    actor_kind: opts.actorKind,
    actor_id: opts.actorId ?? null,
    tenant_id: opts.tenantId ?? null,
    payload_json: opts.payload ? JSON.stringify(opts.payload) : null,
    created_at: new Date().toISOString(),
  };
  const hooks = db
    .prepare(`SELECT * FROM hooks WHERE trigger_kind = 'event' AND enabled = 1`)
    .all() as CoreHook[];
  for (const hook of hooks) {
    if (!eventTypeMatches(hook.event_type, event.type)) continue;
    if (!ownerCanSeeEvent(hook, event)) continue;
    const isGate = hook.action_kind === "gate";
    const isClosedWebhook = failClosedWebhook(hook);
    if (!isGate && !isClosedWebhook) continue;
    const status = await executeHook(hook, event, db);
    if (isGate && (status === "success" || status === "pending_approval")) {
      throw new Error(
        status === "pending_approval"
          ? `Coding blocked: automation "${hook.name}" needs approval`
          : `Coding blocked by automation "${hook.name}"`
      );
    }
    if (isClosedWebhook && status === "error") {
      throw new Error(`Coding blocked by webhook automation "${hook.name}"`);
    }
  }
}
