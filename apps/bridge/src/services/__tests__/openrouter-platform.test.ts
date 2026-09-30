import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { AppDatabase } from "../../db.js";
import {
  getOpenRouterAuthStatus,
  resolveOpenRouterApiKey,
} from "../openrouter-platform.js";

function emptyDb(): AppDatabase {
  return new Database(":memory:") as unknown as AppDatabase;
}

describe("openrouter-platform", () => {
  it("resolves TRIAL_PLATFORM_API_KEY for GodMode Inference shared trial", () => {
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.TRIAL_PLATFORM_API_KEY = "sk-or-trial-shared";
    try {
      const db = emptyDb();
      expect(resolveOpenRouterApiKey(db)).toBe("sk-or-trial-shared");
      expect(getOpenRouterAuthStatus(db)).toEqual({
        connected: true,
        source: "env",
        masked: "sk-o…ared",
      });
      db.close();
    } finally {
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
    }
  });

  it("prefers OPENROUTER_API_KEY over TRIAL_PLATFORM_API_KEY", () => {
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevTrial = process.env.TRIAL_PLATFORM_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-primary";
    process.env.TRIAL_PLATFORM_API_KEY = "sk-or-trial-shared";
    try {
      const db = emptyDb();
      expect(resolveOpenRouterApiKey(db)).toBe("sk-or-primary");
      db.close();
    } finally {
      if (prevOr != null) process.env.OPENROUTER_API_KEY = prevOr;
      else delete process.env.OPENROUTER_API_KEY;
      if (prevTrial != null) process.env.TRIAL_PLATFORM_API_KEY = prevTrial;
      else delete process.env.TRIAL_PLATFORM_API_KEY;
    }
  });
});
