import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  durableEventConsumer,
  relayEventsOnce,
} from "../../services/events-relay.js";

describe("durable events relay", () => {
  it("awaits consumers and records receipts only after success", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_agent_id TEXT,
        subject TEXT,
        payload_json TEXT NOT NULL,
        dispatched INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO events
        (id, seq, ts, type, payload_json, dispatched)
      VALUES ('evt-1', 1, datetime('now'), 'job.ready', '{"ok":true}', 0);
    `);
    const bus = new EventEmitter();
    let attempts = 0;
    bus.on(
      "job.ready",
      durableEventConsumer("test-consumer", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        attempts += 1;
        if (attempts === 1) throw new Error("retry");
      })
    );

    expect(await relayEventsOnce(db, bus, "relay-a")).toBe(0);
    expect(
      (
        db.prepare(`SELECT dispatched FROM events WHERE id='evt-1'`).get() as {
          dispatched: number;
        }
      ).dispatched
    ).toBe(0);
    expect(await relayEventsOnce(db, bus, "relay-b")).toBe(1);
    expect(attempts).toBe(2);
    expect(
      db
        .prepare(
          `SELECT 1 FROM event_consumer_receipts
           WHERE event_id='evt-1' AND consumer_id='test-consumer'`
        )
        .get()
    ).toBeTruthy();
  });
});
