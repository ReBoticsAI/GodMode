import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  FIRST_LAND_GREETING,
  TRIAL_DEFAULT_MODEL_ID,
  TRIAL_PASTE_KEY_PATH,
  TRIAL_PAY_GODMODE_PATH,
  TRIAL_PRIMARY_CTA_LABEL,
  TRIAL_PAY_CTA_LABEL,
  buildFirstLandGreeting,
  buildPersonalOpenRouterSignupUrl,
  ensureTrialInference,
  getTrialInferenceStatus,
  subjectKeyFor,
  trialInferenceConfig,
} from "../trial-inference.js";
import { ensureTrialInferenceTables } from "../trial-inference-schema.js";
import {
  isOpenRouterPlatformReady,
  resolveOpenRouterApiKey,
  OPENROUTER_API_KEY_SECRET_ID,
  OPENROUTER_API_KEY_SECRET_NAME,
} from "../openrouter-platform.js";
import { getPlatformVaultSecretInScope } from "../agents/agents-db.js";
import { getOnboardingStatus } from "../onboarding.js";
import type { AppDatabase } from "../../db.js";
import type { CoreDatabase } from "../../core-db.js";
import type { LlmManager } from "../llm-manager.js";

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
    `INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@b.c', 'Alex Dane')`
  ).run();
  ensureTrialInferenceTables(db);
  return db as unknown as CoreDatabase;
}

function memoryTenant(): AppDatabase {
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

const stubLlm = {
  getStatus: () => ({ state: "stopped" as const }),
} as unknown as LlmManager;

describe("trial-inference", () => {
  it("exports the first-land greeting matching the builder", () => {
    expect(FIRST_LAND_GREETING).toBe(buildFirstLandGreeting());
    expect(FIRST_LAND_GREETING).toContain("GodMode Inference");
    expect(FIRST_LAND_GREETING).toContain("DeepSeek");
    expect(FIRST_LAND_GREETING).not.toContain("OpenRouter");
    expect(FIRST_LAND_GREETING).not.toContain(TRIAL_PASTE_KEY_PATH);
  });

  it("personalizes greeting with GodMode display name and email", () => {
    const g = buildFirstLandGreeting({
      displayName: "Alex Dane",
      email: "a@b.c",
    });
    expect(g.startsWith("Hey Alex.")).toBe(true);
    expect(g).toContain("This welcome tour is for a@b.c");
    expect(g).toContain("GodMode Inference");
    expect(g).not.toContain("OpenRouter");
    expect(g).not.toContain("—");
    expect(g).not.toContain("--");
  });

  it("uses GodMode display name even when OpenRouter username is present", () => {
    const g = buildFirstLandGreeting({
      displayName: "Alex",
      openRouterUserName: "or_alex",
    });
    expect(g.startsWith("Hey Alex.")).toBe(true);
    expect(g).not.toContain("or_alex");
  });

  it("builds a personal signup deep-link with email hints (advanced BYOK)", () => {
    const prev = process.env.TRIAL_AFFILIATE_SIGNUP_URL;
    delete process.env.TRIAL_AFFILIATE_SIGNUP_URL;
    try {
      const built = buildPersonalOpenRouterSignupUrl({ email: "a@b.c" });
      expect(built.initiation).toBe("deep_link");
      expect(built.email).toBe("a@b.c");
      expect(built.url).toContain("email=a%40b.c");
      expect(built.url).toContain("login_hint=a%40b.c");
      const deferred = buildPersonalOpenRouterSignupUrl({});
      expect(deferred.initiation).toBe("deferred_until_email");
    } finally {
      if (prev != null) process.env.TRIAL_AFFILIATE_SIGNUP_URL = prev;
      else delete process.env.TRIAL_AFFILIATE_SIGNUP_URL;
    }
  });

  it("builds distinct subject keys for user vs visitor heuristics", () => {
    expect(subjectKeyFor({ userId: "u1" })).toBe("user:u1");
    const a = subjectKeyFor({
      visitorKey: "v_abc",
      clientIp: "1.2.3.4",
    });
    const b = subjectKeyFor({
      visitorKey: "v_abc",
      clientIp: "9.9.9.9",
    });
    expect(a).toMatch(/^visitor:v_abc:/);
    expect(a).not.toBe(b);
  });

  it("reports unconfigured when no trial keys are set", async () => {
    const prevMgmt = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevDs = process.env.DEEPSEEK_API_KEY;
    const prevZai = process.env.ZAI_API_KEY;
    const prevZaiCoding = process.env.ZAI_CODING_API_KEY;
    const prevDash = process.env.DASHSCOPE_API_KEY;
    const prevQwen = process.env.QWEN_API_KEY;
    const prevDisable = process.env.GODMODE_INFERENCE_DISABLE_SUPPLY;
    delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
    delete process.env.TRIAL_PLATFORM_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ZAI_API_KEY;
    delete process.env.ZAI_CODING_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.QWEN_API_KEY;
    process.env.GODMODE_INFERENCE_DISABLE_SUPPLY = "1";
    try {
      const db = memoryCloud();
      const status = await ensureTrialInference({
        userId: "u1",
        db,
        provision: true,
      });
      expect(status.ready).toBe(false);
      expect(status.status).toBe("unconfigured");
      expect(status.configured.godmodeInferenceSupply).toBe(false);
      expect(status.greeting).toContain("Hey Alex.");
      expect(status.greeting).toContain("a@b.c");
      expect(status.signupEmail).toBe("a@b.c");
      expect(status.signupInitiation).toBe("deep_link");
      expect(status.openRouterUserName).toBeNull();
      expect(status.pasteKeyPath).toBe(TRIAL_PASTE_KEY_PATH);
      expect(status.payGodModePath).toBe(TRIAL_PAY_GODMODE_PATH);
      expect(status.primaryCtaLabel).toBe(TRIAL_PRIMARY_CTA_LABEL);
      expect(status.payCtaLabel).toBe(TRIAL_PAY_CTA_LABEL);
      expect(status.remainingOps.length).toBeGreaterThan(0);
      db.close();
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
      if (prevDs != null) process.env.DEEPSEEK_API_KEY = prevDs;
      else delete process.env.DEEPSEEK_API_KEY;
      if (prevZai != null) process.env.ZAI_API_KEY = prevZai;
      else delete process.env.ZAI_API_KEY;
      if (prevZaiCoding != null) process.env.ZAI_CODING_API_KEY = prevZaiCoding;
      else delete process.env.ZAI_CODING_API_KEY;
      if (prevDash != null) process.env.DASHSCOPE_API_KEY = prevDash;
      else delete process.env.DASHSCOPE_API_KEY;
      if (prevQwen != null) process.env.QWEN_API_KEY = prevQwen;
      else delete process.env.QWEN_API_KEY;
      if (prevDisable != null) process.env.GODMODE_INFERENCE_DISABLE_SUPPLY = prevDisable;
      else delete process.env.GODMODE_INFERENCE_DISABLE_SUPPLY;
    }
  });

  it("defers visitor mint until auth when only mgmt API is configured", async () => {
    const prevMgmt = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevAllow = process.env.TRIAL_ALLOW_VISITOR_MINT;
    const prevOrder = process.env.TRIAL_PROVISION_ORDER;
    const prevDisable = process.env.GODMODE_INFERENCE_DISABLE_SUPPLY;
    process.env.OPENROUTER_MANAGEMENT_API_KEY = "mgmt-test";
    delete process.env.TRIAL_PLATFORM_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.TRIAL_ALLOW_VISITOR_MINT;
    process.env.TRIAL_PROVISION_ORDER = "mgmtApi";
    process.env.GODMODE_INFERENCE_DISABLE_SUPPLY = "1";
    try {
      const db = memoryCloud();
      const status = await ensureTrialInference({
        visitorKey: "v_test",
        clientIp: "10.0.0.1",
        db,
        provision: true,
      });
      expect(status.ready).toBe(false);
      expect(status.status).toBe("deferred_until_auth");
      expect(status.configured.mgmtApi).toBe(true);
      expect(status.signupInitiation).toBe("deferred_until_email");
      db.close();
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
      if (prevAllow != null) process.env.TRIAL_ALLOW_VISITOR_MINT = prevAllow;
      else delete process.env.TRIAL_ALLOW_VISITOR_MINT;
      if (prevOrder != null) process.env.TRIAL_PROVISION_ORDER = prevOrder;
      else delete process.env.TRIAL_PROVISION_ORDER;
      if (prevDisable != null) process.env.GODMODE_INFERENCE_DISABLE_SUPPLY = prevDisable;
      else delete process.env.GODMODE_INFERENCE_DISABLE_SUPPLY;
    }
  });

  it("mints via OpenRouter Management API for authenticated users", async () => {
    const prevMgmt = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevOrder = process.env.TRIAL_PROVISION_ORDER;
    process.env.OPENROUTER_MANAGEMENT_API_KEY = "mgmt-test";
    process.env.TRIAL_PROVISION_ORDER = "mgmtApi";
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { data: { key: "sk-or-v1-trial", hash: "hash1", id: "key-1" } },
        { status: 201 }
      )
    );
    try {
      const db = memoryCloud();
      const status = await ensureTrialInference({
        userId: "u1",
        db,
        provision: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(status.ready).toBe(true);
      expect(status.mechanism).toBe("mgmtApi");
      expect(status.status).toBe("active");
      expect(status.detail).toMatch(/GodMode Inference/i);
      expect(status.detail).toMatch(/pay through GodMode/i);
      expect(status.personalSignupUrl).toContain("email=");
      expect(status.openRouterUserName).toBeNull();
      expect(fetchImpl).toHaveBeenCalledOnce();
      const again = getTrialInferenceStatus({ userId: "u1", db });
      expect(again.ready).toBe(true);
      expect(again.mechanism).toBe("mgmtApi");
      expect(again.greeting).toContain("Hey Alex.");
      expect(again.greeting).toContain("GodMode Inference");
      db.close();
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevOrder != null) process.env.TRIAL_PROVISION_ORDER = prevOrder;
      else delete process.env.TRIAL_PROVISION_ORDER;
    }
  });

  it("falls back to platformShared when mgmt mint fails", async () => {
    const prevMgmt = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    const prevOrder = process.env.TRIAL_PROVISION_ORDER;
    process.env.OPENROUTER_MANAGEMENT_API_KEY = "mgmt-test";
    process.env.TRIAL_PLATFORM_API_KEY = "sk-or-platform";
    process.env.TRIAL_PROVISION_ORDER = "mgmtApi,platformShared";
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: { message: "Only management keys can perform this operation" } },
        { status: 403 }
      )
    );
    try {
      const db = memoryCloud();
      const status = await ensureTrialInference({
        userId: "u1",
        db,
        provision: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(status.ready).toBe(true);
      expect(status.mechanism).toBe("platformShared");
      db.close();
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOrder != null) process.env.TRIAL_PROVISION_ORDER = prevOrder;
      else delete process.env.TRIAL_PROVISION_ORDER;
    }
  });

  it("tells visitors with platform key to sign in for Vault attach", async () => {
    const prevMgmt = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevAllow = process.env.TRIAL_ALLOW_VISITOR_MINT;
    const prevOrder = process.env.TRIAL_PROVISION_ORDER;
    const prevDisable = process.env.GODMODE_INFERENCE_DISABLE_SUPPLY;
    delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
    process.env.TRIAL_PLATFORM_API_KEY = "sk-or-platform";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.TRIAL_ALLOW_VISITOR_MINT;
    process.env.TRIAL_PROVISION_ORDER = "platformShared";
    process.env.GODMODE_INFERENCE_DISABLE_SUPPLY = "1";
    try {
      const db = memoryCloud();
      const status = await ensureTrialInference({
        visitorKey: "v_guest",
        clientIp: "10.0.0.2",
        db,
        provision: true,
      });
      expect(status.ready).toBe(true);
      expect(status.status).toBe("deferred_until_auth");
      expect(status.mechanism).toBe("platformShared");
      expect(status.detail).toMatch(/Sign in/i);
      db.close();
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
      if (prevAllow != null) process.env.TRIAL_ALLOW_VISITOR_MINT = prevAllow;
      else delete process.env.TRIAL_ALLOW_VISITOR_MINT;
      if (prevOrder != null) process.env.TRIAL_PROVISION_ORDER = prevOrder;
      else delete process.env.TRIAL_PROVISION_ORDER;
      if (prevDisable != null) process.env.GODMODE_INFERENCE_DISABLE_SUPPLY = prevDisable;
      else delete process.env.GODMODE_INFERENCE_DISABLE_SUPPLY;
    }
  });

  it("reads ttl and threshold from env", () => {
    const prevTtl = process.env.TRIAL_KEY_TTL_DAYS;
    const prevPrompt = process.env.TRIAL_PROMPT_THRESHOLD;
    process.env.TRIAL_KEY_TTL_DAYS = "14";
    process.env.TRIAL_PROMPT_THRESHOLD = "3";
    try {
      const cfg = trialInferenceConfig();
      expect(cfg.ttlDays).toBe(14);
      expect(cfg.promptThreshold).toBe(3);
    } finally {
      if (prevTtl != null) process.env.TRIAL_KEY_TTL_DAYS = prevTtl;
      else delete process.env.TRIAL_KEY_TTL_DAYS;
      if (prevPrompt != null) process.env.TRIAL_PROMPT_THRESHOLD = prevPrompt;
      else delete process.env.TRIAL_PROMPT_THRESHOLD;
    }
  });

  it("defaults trial model to OpenRouter free router", () => {
    const prev = process.env.TRIAL_DEFAULT_MODEL_ID;
    delete process.env.TRIAL_DEFAULT_MODEL_ID;
    try {
      expect(TRIAL_DEFAULT_MODEL_ID).toBe("openrouter/free");
      expect(trialInferenceConfig().modelId).toBe("openrouter/free");
    } finally {
      if (prev != null) process.env.TRIAL_DEFAULT_MODEL_ID = prev;
      else delete process.env.TRIAL_DEFAULT_MODEL_ID;
    }
  });

  it("keeps affiliate signup as secondary advanced BYOK CTA", () => {
    const prev = process.env.TRIAL_AFFILIATE_SIGNUP_URL;
    delete process.env.TRIAL_AFFILIATE_SIGNUP_URL;
    const db = memoryCloud();
    try {
      const cfg = trialInferenceConfig();
      expect(cfg.affiliateSignupUrl).toBe("https://openrouter.ai/keys");
      const status = getTrialInferenceStatus({ visitorKey: "v_test", db });
      expect(status.affiliateSignupUrl).toBe("https://openrouter.ai/keys");
      expect(status.pasteKeyPath).toBe(TRIAL_PASTE_KEY_PATH);
      expect(status.payGodModePath).toBe(TRIAL_PAY_GODMODE_PATH);
      expect(status.greeting).toContain("GodMode Inference");
      expect(status.greeting).not.toContain("OpenRouter");
    } finally {
      if (prev != null) process.env.TRIAL_AFFILIATE_SIGNUP_URL = prev;
      else delete process.env.TRIAL_AFFILIATE_SIGNUP_URL;
      db.close();
    }
  });

  it("vaults platform shared key and marks llmReady for authenticated tenant", async () => {
    const prevMgmt = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevOrder = process.env.TRIAL_PROVISION_ORDER;
    delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
    process.env.TRIAL_PLATFORM_API_KEY = "sk-or-platform-vault";
    delete process.env.OPENROUTER_API_KEY;
    process.env.TRIAL_PROVISION_ORDER = "platformShared";
    const cloud = memoryCloud();
    const tenant = memoryTenant();
    try {
      const status = await ensureTrialInference({
        userId: "u1",
        db: cloud,
        tenantDb: tenant,
        llm: null,
        provision: true,
      });
      expect(status.ready).toBe(true);
      expect(status.mechanism).toBe("platformShared");
      expect(status.modelId).toBe("openrouter/free");
      expect(getOnboardingStatus(stubLlm, tenant).llmReady).toBe(true);

      // Key must survive in Vault even if process env is cleared (workspace attach).
      delete process.env.TRIAL_PLATFORM_API_KEY;
      expect(isOpenRouterPlatformReady(tenant)).toBe(true);
      expect(resolveOpenRouterApiKey(tenant)).toBe("sk-or-platform-vault");
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
      if (prevOrder != null) process.env.TRIAL_PROVISION_ORDER = prevOrder;
      else delete process.env.TRIAL_PROVISION_ORDER;
      cloud.close();
      tenant.close();
    }
  });

  it("re-attaches shared key to a fresh workspace that already has a grant", async () => {
    const prevMgmt = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevOrder = process.env.TRIAL_PROVISION_ORDER;
    delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
    process.env.TRIAL_PLATFORM_API_KEY = "sk-or-platform-reattach";
    delete process.env.OPENROUTER_API_KEY;
    process.env.TRIAL_PROVISION_ORDER = "platformShared";
    const cloud = memoryCloud();
    const first = memoryTenant();
    try {
      const minted = await ensureTrialInference({
        userId: "u1",
        db: cloud,
        tenantDb: first,
        llm: null,
        provision: true,
      });
      expect(minted.ready).toBe(true);

      const fresh = memoryTenant();
      expect(
        getPlatformVaultSecretInScope(fresh, {
          baseId: OPENROUTER_API_KEY_SECRET_ID,
          name: OPENROUTER_API_KEY_SECRET_NAME,
        })
      ).toBeNull();
      const again = await ensureTrialInference({
        userId: "u1",
        db: cloud,
        tenantDb: fresh,
        llm: null,
        provision: true,
      });
      expect(again.ready).toBe(true);
      expect(again.detail).toMatch(/Re-attached|reused|GodMode Inference/i);
      expect(getOnboardingStatus(stubLlm, fresh).llmReady).toBe(true);
      expect(
        getPlatformVaultSecretInScope(fresh, {
          baseId: OPENROUTER_API_KEY_SECRET_ID,
          name: OPENROUTER_API_KEY_SECRET_NAME,
        })
      ).toBe("sk-or-platform-reattach");

      delete process.env.TRIAL_PLATFORM_API_KEY;
      expect(resolveOpenRouterApiKey(fresh)).toBe("sk-or-platform-reattach");
      fresh.close();
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
      if (prevOrder != null) process.env.TRIAL_PROVISION_ORDER = prevOrder;
      else delete process.env.TRIAL_PROVISION_ORDER;
      cloud.close();
      first.close();
    }
  });
});
