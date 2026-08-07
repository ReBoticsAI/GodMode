import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import {
  createSecret,
  getSecretValue,
  listSecrets,
} from "../agents/agents-db.js";
import {
  budgetAndScrubToolResult,
  scrubSecretsInText,
  scrubSensitiveToolArgs,
  collectAgentSecretPlaintexts,
} from "../secret-scrub.js";

function tenantDb(): AppDatabase {
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
      CHECK (
        (owner_kind = 'agent' AND agent_id IS NOT NULL)
        OR (owner_kind IN ('platform', 'user') AND agent_id IS NULL)
      )
    );
    CREATE UNIQUE INDEX ai_secrets_name_platform_uq
      ON ai_secrets(name) WHERE owner_kind = 'platform';
    CREATE UNIQUE INDEX ai_secrets_name_user_uq
      ON ai_secrets(name) WHERE owner_kind = 'user';
    CREATE UNIQUE INDEX ai_secrets_name_agent_uq
      ON ai_secrets(name, agent_id) WHERE owner_kind = 'agent';
  `);
  return db as unknown as AppDatabase;
}

describe("secret-scrub", () => {
  it("replaces known vault values and SECRETISH patterns", () => {
    const openaiish = "sk-" + "abcdefghijklmnopqrstuvwxyz";
    const ghpish = "ghp_" + "abcdefghijklmnopqrstuvwx";
    const out = scrubSecretsInText(`token ${openaiish} and ${ghpish}`, [
      { ref: "openai-api-key", value: openaiish },
    ]);
    expect(out).toContain("[secret:openai-api-key]");
    expect(out).not.toContain(openaiish);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain(ghpish);
  });

  it("redacts sensitive tool args without touching other fields", () => {
    const scrubbed = scrubSensitiveToolArgs({
      name: "my-secret",
      value: "super-secret-value",
      api_key: "leak-me-please-now",
      path: "docs/x.md",
    });
    expect(scrubbed.name).toBe("my-secret");
    expect(scrubbed.path).toBe("docs/x.md");
    expect(scrubbed.value).toBe("[redacted]");
    expect(scrubbed.api_key).toBe("[redacted]");
  });

  it("scrubs collected agent vault plaintexts from tool results", () => {
    const db = tenantDb();
    createSecret(db, "demo-key", "plain-demo-secret-value-999", {
      kind: "agent",
      agentId: "intelligence",
    });
    const known = collectAgentSecretPlaintexts(db, "intelligence");
    expect(known.some((k) => k.value.includes("plain-demo"))).toBe(true);
    const out = budgetAndScrubToolResult(
      { stdout: "leaked plain-demo-secret-value-999 here" },
      { known }
    );
    expect(out).not.toContain("plain-demo-secret-value-999");
    expect(out).toMatch(/\[secret:demo-key\]/);
  });
});

describe("vault fail-closed decrypt", () => {
  it("does not return legacy plaintext stored without encryption", () => {
    const db = tenantDb();
    db.prepare(
      `INSERT INTO ai_secrets (id, name, value, agent_id, owner_kind)
       VALUES (?, ?, ?, NULL, 'platform')`
    ).run("legacy-1", "legacy_key", "not-encrypted-plain-text-value");
    expect(getSecretValue(db, "legacy-1")).toBeNull();
    const listed = listSecrets(db, { kind: "platform" });
    expect(listed).toHaveLength(1);
    expect(listed[0].masked).toBe("••••••••");
  });

  it("still resolves values written via createSecret", () => {
    const db = tenantDb();
    const created = createSecret(db, "ok", "readable-secret-value-abc", {
      kind: "platform",
    });
    expect(getSecretValue(db, created.id)).toBe("readable-secret-value-abc");
    expect(listSecrets(db, { kind: "platform" })[0].masked).not.toContain(
      "readable-secret"
    );
  });
});
