import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ensureTrialInferenceTables } from "../trial-inference-schema.js";
import {
  defaultTrialBudgetUsd,
  listAdminGodModeInferenceGrants,
  patchGodModeInferenceGrantBudget,
  revokeGodModeInferenceGrant,
  setDefaultTrialBudgetUsd,
  topUpGodModeInferenceGrant,
} from "../godmode-inference-grants.js";
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
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@b.c', 'Alex')`
  ).run();
  ensureTrialInferenceTables(db);
  return db as unknown as CoreDatabase;
}

describe("godmode-inference admin grants", () => {
  it("lists grants with remaining budget", () => {
    const db = memoryCloud();
    const grant = topUpGodModeInferenceGrant({
      userId: "u1",
      kind: "trial",
      budgetUsd: 0.1,
      db,
    });
    const listed = listAdminGodModeInferenceGrants({ db, limit: 10 });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(grant.id);
    expect(listed[0].budget_usd).toBeCloseTo(0.1);
    expect(listed[0].remaining_usd).toBeCloseTo(0.1);
    expect(listed[0].status).toBe("active");
  });

  it("revokes a grant so it is no longer active", () => {
    const db = memoryCloud();
    const grant = topUpGodModeInferenceGrant({
      userId: "u1",
      kind: "trial",
      budgetUsd: 0.1,
      db,
    });
    const revoked = revokeGodModeInferenceGrant(grant.id, db);
    expect(revoked?.status).toBe("revoked");
    const listed = listAdminGodModeInferenceGrants({
      db,
      status: "revoked",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(grant.id);
  });

  it("patches budget and expires when spent exceeds new budget", () => {
    const db = memoryCloud();
    const grant = topUpGodModeInferenceGrant({
      userId: "u1",
      kind: "trial",
      budgetUsd: 1,
      db,
    });
    db.prepare(
      `UPDATE trial_inference_grants SET spent_usd=0.5 WHERE id=?`
    ).run(grant.id);
    const updated = patchGodModeInferenceGrantBudget(grant.id, 0.2, db);
    expect(updated?.budget_usd).toBeCloseTo(0.2);
    expect(updated?.status).toBe("expired");
  });

  it("persists default trial budget on platform meta", () => {
    const db = memoryCloud();
    expect(defaultTrialBudgetUsd(db)).toBe(0.1);
    const next = setDefaultTrialBudgetUsd(0.25, db);
    expect(next).toBe(0.25);
    expect(defaultTrialBudgetUsd(db)).toBe(0.25);
  });
});
