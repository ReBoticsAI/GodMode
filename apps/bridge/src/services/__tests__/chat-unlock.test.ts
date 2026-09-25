import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  completeUnlockTutorial,
  getChatUnlockStatus,
  getUnlockable,
  grantUnlockEntitlement,
  hasUnlockEntitlement,
  listUnlockableCatalog,
  markTutorialStep,
  startUnlockTutorial,
} from "../chat-unlock.js";
import { ensureChatUnlockTables } from "../chat-unlock-schema.js";
import type { CoreDatabase } from "../../core-db.js";

function memoryCloud(): CoreDatabase {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@b.c', 'A')`
  ).run();
  ensureChatUnlockTables(db);
  return db as unknown as CoreDatabase;
}

describe("chat-unlock", () => {
  it("lists seeded unlockables with skip prices", () => {
    const catalog = listUnlockableCatalog();
    expect(catalog.map((u) => u.id).sort()).toEqual([
      "chat_create",
      "chat_window",
    ]);
    expect(getUnlockable("chat_window")?.skip_price_cents).toBe(9999);
    expect(getUnlockable("chat_create")?.skip_price_cents).toBe(9_999_900);
  });

  it("grants entitlement via tutorial steps then complete", () => {
    const core = memoryCloud();
    expect(hasUnlockEntitlement("u1", "chat_window", core)).toBe(false);
    startUnlockTutorial("u1", "chat_window", core);
    for (const step of [
      "open_chat",
      "send_message",
      "acknowledge_graph",
      "confirm_controls",
    ]) {
      markTutorialStep("u1", "chat_window", step, core);
    }
    expect(hasUnlockEntitlement("u1", "chat_window", core)).toBe(true);
    const ent = completeUnlockTutorial("u1", "chat_window", core);
    expect(ent.method).toBe("tutorial");
    const status = getChatUnlockStatus("u1", core);
    // Phase 5: product retired; gates always open.
    expect(status.canCloseResize).toBe(true);
    expect(status.canCreateChat).toBe(true);
    expect(status.unlockables.every((u) => u.entitled)).toBe(true);
  });

  it("rejects complete when steps are incomplete", () => {
    const core = memoryCloud();
    startUnlockTutorial("u1", "chat_create", core);
    markTutorialStep("u1", "chat_create", "open_chat", core);
    expect(() => completeUnlockTutorial("u1", "chat_create", core)).toThrow(
      /incomplete/i
    );
  });

  it("grants via purchase method without double insert", () => {
    const core = memoryCloud();
    const a = grantUnlockEntitlement({
      userId: "u1",
      unlockableId: "chat_create",
      method: "purchase",
      transactionId: "tx1",
      db: core,
    });
    const b = grantUnlockEntitlement({
      userId: "u1",
      unlockableId: "chat_create",
      method: "tutorial",
      db: core,
    });
    expect(a.id).toBe(b.id);
    expect(a.method).toBe("purchase");
  });

  it("reports chrome open for anonymous and entitled users", () => {
    const core = memoryCloud();
    const anon = getChatUnlockStatus(undefined, core);
    expect(anon.canCloseResize).toBe(true);
    expect(anon.canCreateChat).toBe(true);
  });
});
