import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  FIRST_LAND_GREETING,
  ensureTrialInference,
  getTrialInferenceStatus,
  subjectKeyFor,
  trialInferenceConfig,
} from "../trial-inference.js";
import { ensureTrialInferenceTables } from "../trial-inference-schema.js";
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
  ensureTrialInferenceTables(db);
  return db as unknown as CoreDatabase;
}

describe("trial-inference", () => {
  it("exports the first-land greeting", () => {
    expect(FIRST_LAND_GREETING).toBe(
      "Hey, you're in control. Put us to work."
    );
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
    delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
    delete process.env.TRIAL_PLATFORM_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const db = memoryCloud();
      const status = await ensureTrialInference({
        userId: "u1",
        db,
        provision: true,
      });
      expect(status.ready).toBe(false);
      expect(status.status).toBe("unconfigured");
      expect(status.greeting).toBe(FIRST_LAND_GREETING);
      expect(status.remainingOps.length).toBeGreaterThan(0);
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("defers visitor mint until auth when only mgmt API is configured", async () => {
    const prevMgmt = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevAllow = process.env.TRIAL_ALLOW_VISITOR_MINT;
    process.env.OPENROUTER_MANAGEMENT_API_KEY = "mgmt-test";
    delete process.env.TRIAL_PLATFORM_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.TRIAL_ALLOW_VISITOR_MINT;
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
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
      if (prevAllow != null) process.env.TRIAL_ALLOW_VISITOR_MINT = prevAllow;
      else delete process.env.TRIAL_ALLOW_VISITOR_MINT;
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
      expect(fetchImpl).toHaveBeenCalledOnce();
      const again = getTrialInferenceStatus({ userId: "u1", db });
      expect(again.ready).toBe(true);
      expect(again.mechanism).toBe("mgmtApi");
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
    } finally {
      if (prevMgmt != null) process.env.OPENROUTER_MANAGEMENT_API_KEY = prevMgmt;
      else delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
      if (prevOrder != null) process.env.TRIAL_PROVISION_ORDER = prevOrder;
      else delete process.env.TRIAL_PROVISION_ORDER;
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
});
