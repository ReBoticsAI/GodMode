import type { EventEmitter } from "node:events";
import type { AppDatabase } from "../db.js";
import {
  listUndispatchedEvents,
  markEventsDispatched,
} from "./data-management-migration.js";

const RELAY_INTERVAL_MS = Number(process.env.EVENTS_RELAY_INTERVAL_MS ?? 500);

export function startEventsRelay(db: AppDatabase, bus: EventEmitter): () => void {
  const tick = () => {
    try {
      const batch = listUndispatchedEvents(db, 200);
      if (batch.length === 0) return;
      const ids: string[] = [];
      for (const evt of batch) {
        ids.push(evt.id);
        let payload: unknown = {};
        try {
          payload = JSON.parse(evt.payload_json);
        } catch {
          /* ignore */
        }
        bus.emit("platform.event", {
          id: evt.id,
          seq: evt.seq,
          ts: evt.ts,
          type: evt.type,
          actorAgentId: evt.actor_agent_id,
          subject: evt.subject,
          payload,
        });
        bus.emit(evt.type, payload);
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
