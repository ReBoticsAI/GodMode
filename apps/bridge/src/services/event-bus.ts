import { v4 as uuidv4 } from "uuid";
import {
  getCloudDb,
  type CoreDatabase,
  type CoreEvent,
  type EventActorKind,
} from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { dispatchEvent } from "./hook-dispatcher.js";
import { getPluginHost } from "@godmode/plugin-host";
import {
  ensurePlatformEventsWorkspaceSchema,
} from "./platform-events-workspace-migrate.js";

export interface EventActor {
  kind: EventActorKind;
  id?: string | null;
}

export interface EmitEventInput {
  type: string;
  actor: EventActor;
  /** Required Workspace id. NULL is not allowed. */
  tenantId: string;
  payload?: Record<string, unknown>;
}

export class PlatformEventError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "PlatformEventError";
  }
}

function requireWorkspaceId(tenantId: string | null | undefined): string {
  const id = typeof tenantId === "string" ? tenantId.trim() : "";
  if (!id) {
    throw new PlatformEventError(
      "PlatformEvent requires a Workspace id (tenantId)"
    );
  }
  return id;
}

function platformEventsDb(tenantId: string): CoreDatabase {
  const db = getTenantDb(tenantId) as CoreDatabase;
  ensurePlatformEventsWorkspaceSchema(db);
  return db;
}

/**
 * Append a PlatformEvent to the Workspace log and hand it to the hook
 * dispatcher. Dispatch is best-effort and never blocks/throws into the caller.
 */
export function emitEvent(input: EmitEventInput): CoreEvent {
  const tenantId = requireWorkspaceId(input.tenantId);
  const db = platformEventsDb(tenantId);
  const id = uuidv4();
  db.prepare(
    `INSERT INTO platform_events
       (id, type, actor_kind, actor_id, tenant_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.type,
    input.actor.kind,
    input.actor.id ?? null,
    tenantId,
    input.payload ? JSON.stringify(input.payload) : null
  );
  const row = db
    .prepare(`SELECT * FROM platform_events WHERE id = ?`)
    .get(id) as CoreEvent;
  try {
    void dispatchEvent(row, db);
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
 * Recent PlatformEvents in the owner's Workspace (and rows they produced there).
 */
export function listEventsForOwner(
  owner: { kind: EventActorKind; id: string; tenantId: string },
  opts: { limit?: number } = {},
  db?: CoreDatabase
): CoreEvent[] {
  const tenantId = requireWorkspaceId(owner.tenantId);
  const workspace = db ?? platformEventsDb(tenantId);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return workspace
    .prepare(
      `SELECT * FROM platform_events
       WHERE tenant_id = ?
          OR (actor_kind = ? AND actor_id = ?)
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(tenantId, owner.kind, owner.id, limit) as CoreEvent[];
}

/** Distinct event types seen recently, to populate hook-builder dropdowns. */
export function listKnownEventTypes(db?: CoreDatabase): string[] {
  const seen = new Set<string>();
  if (db) {
    ensurePlatformEventsWorkspaceSchema(db);
    const rows = db
      .prepare(
        `SELECT DISTINCT type FROM platform_events ORDER BY type ASC LIMIT 200`
      )
      .all() as Array<{ type: string }>;
    for (const r of rows) seen.add(r.type);
  }
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

/** Resolve a PlatformEvent by id from a Workspace DB, then Cloud orphan log. */
export function findPlatformEvent(
  eventId: string,
  preferredDb?: CoreDatabase
): CoreEvent | null {
  if (preferredDb) {
    ensurePlatformEventsWorkspaceSchema(preferredDb);
    const row = preferredDb
      .prepare(`SELECT * FROM platform_events WHERE id = ?`)
      .get(eventId) as CoreEvent | undefined;
    if (row) return row;
  }
  const cloud = getCloudDb();
  return (
    (cloud
      .prepare(`SELECT * FROM events WHERE id = ?`)
      .get(eventId) as CoreEvent | undefined) ?? null
  );
}
