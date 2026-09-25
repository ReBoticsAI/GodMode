import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ensureTrialInferenceTables } from "../trial-inference-schema.js";
import {
  findActiveGodModeInferenceGrant,
  isGrantSpendable,
  recordGodModeInferenceSpend,
  resolveGodModeInferenceSupplyForManagedChat,
  topUpGodModeInferenceGrant,
} from "../godmode-inference-grants.js";
import { resolveSecretRefForAgent } from "../agents/agents-db.js";
import type { AppDatabase } from "../../db.js";
import type { CoreDatabase } from "../../core-db.js";

function memoryCloud(): CoreDatabase {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL
    );
    CREATE TABLE platform_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@b.c', 'Alex')`
  ).run();
  ensureTrialInferenceTables(db);
  return db as unknown as CoreDatabase;
}

function memoryTenant(): AppDatabase {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ai_secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      agent_id TEXT,
      owner_kind TEXT NOT NULL DEFAULT 'platform'
        CHECK (owner_kind IN ('platform', 'user', 'agent')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
        (owner_kind = 'agent' AND agent_id IS NOT NULL)
        OR (owner_kind IN ('platform', 'user') AND agent_id IS NULL)
      )
    );
    CREATE UNIQUE INDEX ai_secrets_name_platform_uq
      ON ai_secrets(name) WHERE owner_kind = 'platform';
  `);
  return db as unknown as AppDatabase;
}

describe("godmode-inference isolation", () => {
  it("does not fall back to supply from resolveSecretRefForAgent", () => {
    const tenant = memoryTenant();
    expect(
      resolveSecretRefForAgent(tenant, "deepseek-api-key", "research-agent")
    ).toBeNull();
    expect(
      resolveSecretRefForAgent(tenant, "deepseek-api-key", "intelligence")
    ).toBeNull();
  });

  it("gates managed supply on Intelligence + active grant", () => {
    const cloud = memoryCloud();
    // No grant → no key even for Intelligence (without provisionAttach).
    expect(
      resolveGodModeInferenceSupplyForManagedChat("deepseek-api-key", {
        agentId: "intelligence",
        userId: "u1",
        db: cloud,
      })
    ).toBeNull();

    expect(
      resolveGodModeInferenceSupplyForManagedChat("deepseek-api-key", {
        agentId: "other-agent",
        userId: "u1",
        provisionAttach: true,
        db: cloud,
      })
    ).toBeNull();
  });

  it("tops up packs and meters spend until budget exhausts", () => {
    const cloud = memoryCloud();
    const grant = topUpGodModeInferenceGrant({
      userId: "u1",
      kind: "pack",
      budgetUsd: 0.004,
      db: cloud,
    });
    expect(isGrantSpendable(grant)).toBe(true);
    recordGodModeInferenceSpend({ grantId: grant.id, usd: 0.002, db: cloud });
    const mid = findActiveGodModeInferenceGrant({ userId: "u1", db: cloud });
    expect(mid?.spent_usd).toBeCloseTo(0.002);
    expect(isGrantSpendable(mid)).toBe(true);
    recordGodModeInferenceSpend({ grantId: grant.id, usd: 0.002, db: cloud });
    const done = findActiveGodModeInferenceGrant({ userId: "u1", db: cloud });
    expect(done).toBeNull();
  });
});
