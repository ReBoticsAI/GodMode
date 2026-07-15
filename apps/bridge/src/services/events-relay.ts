import type { EventEmitter } from "node:events";
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

export function startEventsRelay(db: AppDatabase, bus: EventEmitter): () => void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_consumer_receipts (
      event_id TEXT NOT NULL,
      consumer_id TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, consumer_id)
    )
  `);
  const dispatch = (
    eventId: string,
    channel: string,
    value: unknown
  ): boolean => {
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
      try {
        listener(value);
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
      }
    }
    return true;
  };
  const tick = () => {
    try {
      const batch = listUndispatchedEvents(db, 200);
      if (batch.length === 0) return;
      const ids: string[] = [];
      for (const evt of batch) {
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
        if (
          dispatch(evt.id, "platform.event", envelope) &&
          dispatch(evt.id, evt.type, payload)
        ) {
          ids.push(evt.id);
        }
      }
      markEventsDispatched(db, ids);
    } catch (err) {
      console.warn("[events] relay failed:", err instanceof Error ? err.message : err);
    }
  };

  tick();
  const timer = setInterval(tick, RELAY_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
