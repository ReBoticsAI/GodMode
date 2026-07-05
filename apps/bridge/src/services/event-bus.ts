import { v4 as uuidv4 } from "uuid";
import {
  getCoreDb,
  type CoreDatabase,
  type CoreEvent,
  type EventActorKind,
} from "../core-db.js";
import { dispatchEvent } from "./hook-dispatcher.js";
import { getPluginHost } from "@godmode/plugin-host";

export interface EventActor {
  kind: EventActorKind;
  id?: string | null;
}

export interface EmitEventInput {
  type: string;
  actor: EventActor;
  payload?: Record<string, unknown>;
  tenantId?: string | null;
}

/**
 * Append an event to the immutable log and synchronously hand it to the hook
 * dispatcher. Dispatch is best-effort and never blocks/throws into the caller.
 */
export function emitEvent(
  input: EmitEventInput,
  db: CoreDatabase = getCoreDb()
): CoreEvent {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO events (id, type, actor_kind, actor_id, tenant_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.type,
    input.actor.kind,
    input.actor.id ?? null,
    input.tenantId ?? null,
    input.payload ? JSON.stringify(input.payload) : null
  );
  const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as CoreEvent;
  try {
    void dispatchEvent(row);
    getPluginHost().dispatchSystemEventHandlers?.({
      type: row.type,
      payload_json: row.payload_json,
    });
  } catch (err) {
    console.error("[event-bus] dispatch failed", err);
  }
  return row;
}

/**
 * Recent events visible to a hook owner: global/system events (no tenant),
 * events in the owner's tenant, or events the owner directly produced.
 */
export function listEventsForOwner(
  owner: { kind: EventActorKind; id: string; tenantId: string | null },
  opts: { limit?: number } = {},
  db: CoreDatabase = getCoreDb()
): CoreEvent[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return db
    .prepare(
      `SELECT * FROM events
       WHERE tenant_id IS NULL
          OR tenant_id = ?
          OR (actor_kind = ? AND actor_id = ?)
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(owner.tenantId, owner.kind, owner.id, limit) as CoreEvent[];
}

/** Distinct event types seen recently, to populate hook-builder dropdowns. */
export function listKnownEventTypes(db: CoreDatabase = getCoreDb()): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT type FROM events ORDER BY type ASC LIMIT 200`)
    .all() as Array<{ type: string }>;
  const seen = new Set(rows.map((r) => r.type));
  // Always advertise the emitters we wire so an empty log still offers choices.
  for (const t of [
    "dm.message.created",
    "support.ticket.created",
    "share.created",
    "agent.run.completed",
    "schedule.tick",
    "backtest.completed",
    "backtest.cancelled",
    "backtest.failed",
  ]) {
    seen.add(t);
  }
  return [...seen].sort();
}
