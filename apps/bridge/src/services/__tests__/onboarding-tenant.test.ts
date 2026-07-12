/**
 * Lightweight checks for per-tenant onboarding helpers.
 * Run: npx tsx apps/bridge/src/services/__tests__/onboarding-tenant.test.ts
 */
process.env.DEPLOYMENT_MODE = "hub";

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import type { LlmManager } from "../llm-manager.js";

const { getOnboardingStatus, markLlmReady, markOnboardingComplete } = await import(
  "../onboarding.js"
);

function emptyTenantDb(): AppDatabase {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ai_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db as unknown as AppDatabase;
}

const stubLlm = {
  getStatus: () => ({ state: "stopped" as const }),
} as unknown as LlmManager;

{
  const db = emptyTenantDb();
  const before = getOnboardingStatus(stubLlm, db);
  assert.equal(before.completed, false);
  assert.equal(before.llmReady, false);

  markLlmReady(db);
  const mid = getOnboardingStatus(stubLlm, db);
  assert.equal(mid.llmReady, true);
  assert.equal(mid.completed, false);

  markOnboardingComplete(db);
  const after = getOnboardingStatus(stubLlm, db);
  assert.equal(after.completed, true);
  assert.equal(after.llmReady, true);
}

{
  const a = emptyTenantDb();
  const b = emptyTenantDb();
  markOnboardingComplete(a);
  markLlmReady(a);
  const statusB = getOnboardingStatus(stubLlm, b);
  assert.equal(statusB.completed, false, "other workspace must not inherit onboarding");
  assert.equal(statusB.llmReady, false);
}

{
  const none = getOnboardingStatus(stubLlm, null);
  assert.equal(none.completed, false);
  assert.equal(none.llmReady, false);
}

console.log("onboarding-tenant.test.ts: ok");
