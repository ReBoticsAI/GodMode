import type { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";
import {
  listUndispatchedEvents,
  markEventsDispatched,
} from "./data-management-migration.js";

const RELAY_INTERVAL_MS = Number(process.env.EVENTS_RELAY_INTERVAL_MS ?? 500);
const CONSUMER_ID = Symbol.for("godmode.eventConsumerId");

export function durableEventConsumer<T extends (...args: never[]) => unknown>(
  id: string,
  listener: T
): T {
  Object.defineProperty(listener, CONSUMER_ID, { value: id });
  return listener;
}

export async function relayEventsOnce(
  db: AppDatabase,
  bus: EventEmitter,
  relayId = randomUUID()
): Promise<number> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_consumer_receipts (
      event_id TEXT NOT NULL,
      consumer_id TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, consumer_id)
    );
    CREATE TABLE IF NOT EXISTS event_relay_leases (
      event_id TEXT PRIMARY KEY,
      lease_owner TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL
    );
  `);
  const dispatch = async (
    eventId: string,
    channel: string,
    value: unknown
  ): Promise<boolean> => {
    const listeners = bus.listeners(channel);
    for (const [index, listener] of listeners.entries()) {
      const consumerId = String(
        (listener as unknown as Record<symbol, unknown>)[CONSUMER_ID] ??
          `${channel}:${listener.name || "anonymous"}:${index}`
      );
      const complete = db
        .prepare(
          `SELECT 1 FROM event_consumer_receipts
           WHERE event_id=? AND consumer_id=?`
        )
        .get(eventId, consumerId);
      if (complete) continue;
      const heartbeat = setInterval(() => {
        db.prepare(
          `UPDATE event_relay_leases
           SET lease_expires_at=datetime('now', '+60 seconds')
           WHERE event_id=? AND lease_owner=?`
        ).run(eventId, relayId);
      }, 20_000);
      heartbeat.unref?.();
      try {
        await Promise.resolve(listener(value));
        db.prepare(
          `INSERT OR IGNORE INTO event_consumer_receipts (event_id, consumer_id)
           VALUES (?, ?)`
        ).run(eventId, consumerId);
      } catch (error) {
        console.warn(
          `[events] consumer ${consumerId} failed:`,
          error instanceof Error ? error.message : error
        );
        return false;
      } finally {
        clearInterval(heartbeat);
      }
    }
    return true;
  };
  const claim = (eventId: string): boolean =>
    db.transaction(() => {
      db.prepare(
        `DELETE FROM event_relay_leases
         WHERE event_id=? AND lease_expires_at <= datetime('now')`
      ).run(eventId);
      return (
        db.prepare(
          `INSERT OR IGNORE INTO event_relay_leases
           (event_id, lease_owner, lease_expires_at)
           VALUES (?, ?, datetime('now', '+60 seconds'))`
        ).run(eventId, relayId).changes === 1
      );
    })();
  const release = (eventId: string): void => {
    db.prepare(
      `DELETE FROM event_relay_leases WHERE event_id=? AND lease_owner=?`
    ).run(eventId, relayId);
  };
  const batch = listUndispatchedEvents(db, 200);
  const ids: string[] = [];
  for (const evt of batch) {
    if (!claim(evt.id)) continue;
    let payload: unknown = {};
    try {
      payload = JSON.parse(evt.payload_json);
    } catch {
      /* ignore */
    }
    const envelope = {
      id: evt.id,
      seq: evt.seq,
      ts: evt.ts,
      type: evt.type,
      actorAgentId: evt.actor_agent_id,
      subject: evt.subject,
      payload,
    };
    try {
      if (
        (await dispatch(evt.id, "platform.event", envelope)) &&
        (await dispatch(evt.id, evt.type, payload))
      ) {
        ids.push(evt.id);
      }
    } finally {
      release(evt.id);
    }
  }
  markEventsDispatched(db, ids);
  return ids.length;
}

export function startEventsRelay(db: AppDatabase, bus: EventEmitter): () => void {
  let running = false;
  const relayId = randomUUID();
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await relayEventsOnce(db, bus, relayId);
    } catch (err) {
      console.warn("[events] relay failed:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), RELAY_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function startTenantEventsRelay(
  databases: () => Array<{ tenantId: string; db: AppDatabase }>,
  bus: EventEmitter
): () => void {
  let running = false;
  const relayId = randomUUID();
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const database of databases()) {
        try {
          await relayEventsOnce(database.db, bus, relayId);
        } catch (error) {
          console.warn(
            `[events] tenant ${database.tenantId} relay failed:`,
            error instanceof Error ? error.message : error
          );
        }
      }
    } catch (error) {
      console.warn(
        "[events] tenant relay failed:",
        error instanceof Error ? error.message : error
      );
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), RELAY_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
