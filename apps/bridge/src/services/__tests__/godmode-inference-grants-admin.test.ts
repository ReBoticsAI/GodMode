import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { ensureTrialInferenceTables } from "../trial-inference-schema.js";
import {
  defaultTrialBudgetUsd,
  listAdminGodModeInferenceGrants,
  maskProviderKeyHash,
  patchGodModeInferenceGrantBudget,
  revokeAdminGodModeInferenceGrant,
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
    expect(listed[0].mechanism).toBe("godmodeInferenceSupply");
    expect(listed[0].provider_key_hash_masked).toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(listed[0], "provider_key_hash")
    ).toBe(false);
  });

  it("masks provider key hashes for Admin", () => {
    expect(maskProviderKeyHash(null)).toBeNull();
    expect(maskProviderKeyHash("abcdefghijklmnop")).toBe("abcdefgh…");
  });

  it("lists minted key metadata without full hash", () => {
    const db = memoryCloud();
    const id = "grant-mgmt-1";
    const fullHash = "f01d52606dc8f0a8303a7b5cc3fa07109c2e346cec7c0a16b40de462992ce943";
    db.prepare(
      `INSERT INTO trial_inference_grants (
         id, subject_key, user_id, visitor_key, provider, mechanism, status,
         kind, model_id, prompt_count, spent_usd, budget_usd,
         provider_key_hash, provider_key_id
       ) VALUES (?, ?, 'u1', NULL, 'openrouter', 'mgmtApi', 'active',
         'trial', 'openrouter/free', 0, 0, 0.1, ?, ?)`
    ).run(id, "user:u1:trial", fullHash, "key-id-99");
    const listed = listAdminGodModeInferenceGrants({ db, limit: 10 });
    expect(listed[0].mechanism).toBe("mgmtApi");
    expect(listed[0].provider_key_id).toBe("key-id-99");
    expect(listed[0].provider_key_hash_masked).toBe("f01d5260…");
    expect(JSON.stringify(listed[0])).not.toContain(fullHash);
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

  it("admin revoke for mgmtApi deletes OpenRouter key by hash", async () => {
    const db = memoryCloud();
    const id = "grant-mgmt-2";
    const fullHash = "abc123hashvalue000111222333444555666777888999aaabbbcccdddeee";
    db.prepare(
      `INSERT INTO trial_inference_grants (
         id, subject_key, user_id, visitor_key, provider, mechanism, status,
         kind, model_id, prompt_count, spent_usd, budget_usd,
         provider_key_hash, provider_key_id
       ) VALUES (?, ?, 'u1', NULL, 'openrouter', 'mgmtApi', 'active',
         'trial', 'openrouter/free', 0, 0, 0.1, ?, ?)`
    ).run(id, "user:u1:trial-mgmt", fullHash, "key-42");

    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain(`/keys/${fullHash}`);
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const updated = await revokeAdminGodModeInferenceGrant(id, {
      db,
      fetchImpl,
      mgmtKey: "sk-or-mgmt-test",
    });
    expect(updated?.status).toBe("revoked");
    expect(fetchImpl).toHaveBeenCalledOnce();
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
