/**
 * GodMode Inference retail (2× Flash) math + usage parse.
 * Run: npx vitest run apps/bridge/src/services/__tests__/godmode-inference-retail.test.ts
 */
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ensureTrialInferenceTables } from "../trial-inference-schema.js";
import {
  DEFAULT_RETAIL_CACHED_PER_M_USD,
  DEFAULT_RETAIL_INPUT_PER_M_USD,
  DEFAULT_RETAIL_OUTPUT_PER_M_USD,
  findActiveGodModeInferenceGrant,
  godModeInferenceRetailUsd,
  parseGodModeInferenceUsage,
  recordGodModeInferenceSpend,
  topUpGodModeInferenceGrant,
} from "../godmode-inference-grants.js";
import {
  addProviderUsage,
  emptyProviderUsage,
} from "../agents/provider-backend.js";
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
    `INSERT INTO users (id, email, display_name) VALUES ('u-retail', 'r@b.c', 'Retail')`
  ).run();
  ensureTrialInferenceTables(db);
  return db as unknown as CoreDatabase;
}

describe("godModeInferenceRetailUsd", () => {
  it("charges 1M input + 1M output at 2× Flash list ($1.30)", () => {
    const usd = godModeInferenceRetailUsd({
      promptTokens: 1_000_000,
      cachedTokens: 0,
      completionTokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(
      DEFAULT_RETAIL_INPUT_PER_M_USD + DEFAULT_RETAIL_OUTPUT_PER_M_USD,
      6
    );
    expect(usd).toBeCloseTo(1.3, 6);
  });

  it("bills cached input at the cached rate", () => {
    const usd = godModeInferenceRetailUsd({
      promptTokens: 1_000_000,
      cachedTokens: 1_000_000,
      completionTokens: 0,
    });
    expect(usd).toBeCloseTo(DEFAULT_RETAIL_CACHED_PER_M_USD, 6);
    expect(usd).toBeCloseTo(0.06, 6);
  });

  it("counts reasoning tokens as output", () => {
    const usd = godModeInferenceRetailUsd({
      promptTokens: 0,
      completionTokens: 500_000,
      reasoningTokens: 500_000,
    });
    expect(usd).toBeCloseTo(DEFAULT_RETAIL_OUTPUT_PER_M_USD, 6);
  });

  it("splits mixed prompt into input + cached", () => {
    const usd = godModeInferenceRetailUsd({
      promptTokens: 1_000_000,
      cachedTokens: 250_000,
      completionTokens: 0,
    });
    expect(usd).toBeCloseTo(
      (750_000 * DEFAULT_RETAIL_INPUT_PER_M_USD) / 1_000_000 +
        (250_000 * DEFAULT_RETAIL_CACHED_PER_M_USD) / 1_000_000,
      6
    );
  });
});

describe("parseGodModeInferenceUsage", () => {
  it("reads OpenAI-style usage with cached and reasoning details", () => {
    const parsed = parseGodModeInferenceUsage({
      prompt_tokens: 1200,
      completion_tokens: 80,
      prompt_tokens_details: { cached_tokens: 400 },
      completion_tokens_details: { reasoning_tokens: 20 },
    });
    expect(parsed).toEqual({
      promptTokens: 1200,
      cachedTokens: 400,
      completionTokens: 80,
      reasoningTokens: 20,
    });
  });

  it("returns null when all token counts are zero", () => {
    expect(
      parseGodModeInferenceUsage({
        prompt_tokens: 0,
        completion_tokens: 0,
      })
    ).toBeNull();
  });
});

describe("addProviderUsage", () => {
  it("accumulates SSE usage chunks into onUsage shape", () => {
    const totals = emptyProviderUsage();
    addProviderUsage(totals, {
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 40 },
    });
    addProviderUsage(totals, {
      prompt_tokens: 50,
      completion_tokens: 5,
      completion_tokens_details: { reasoning_tokens: 3 },
    });
    expect(totals.prompt_tokens).toBe(150);
    expect(totals.completion_tokens).toBe(15);
    expect(totals.cached_tokens).toBe(40);
    expect(totals.reasoning_tokens).toBe(3);
    expect(totals.total_tokens).toBe(150 + 15 + 3);
  });
});

describe("recordGodModeInferenceSpend with retail usd", () => {
  it("debits an explicit metered usd amount", () => {
    const cloud = memoryCloud();
    const grant = topUpGodModeInferenceGrant({
      userId: "u-retail",
      kind: "pack",
      budgetUsd: 1,
      db: cloud,
    });

    const retail = godModeInferenceRetailUsd({
      promptTokens: 100_000,
      cachedTokens: 0,
      completionTokens: 50_000,
    });
    expect(retail).toBeCloseTo(0.08, 6);

    recordGodModeInferenceSpend({
      grantId: grant.id,
      usd: retail,
      db: cloud,
    });

    const mid = findActiveGodModeInferenceGrant({
      userId: "u-retail",
      db: cloud,
    });
    expect(mid?.spent_usd).toBeCloseTo(0.08, 5);
  });
});
