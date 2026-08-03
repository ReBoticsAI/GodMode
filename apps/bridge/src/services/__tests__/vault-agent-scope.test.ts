/**
 * Platform / User / Agent Vault isolation + Agent → Platform fallback (#330 slice 2).
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { AppDatabase } from "../../db.js";
import {
  createSecret,
  deleteSecret,
  findSecretByName,
  getPlatformVaultSecretInScope,
  getSecretValueForAgent,
  listSecrets,
  platformVaultSecretId,
  resolvePlatformVaultSecret,
  resolveSecretByName,
  resolveSecretRefForAgent,
  upsertPlatformVaultSecret,
} from "../agents/agents-db.js";
import { resolveExaApiKey } from "../exa-web.js";
import {
  OPENAI_API_KEY_SECRET_ID,
  OPENAI_API_KEY_SECRET_NAME,
  resolveOpenAiApiKey,
  upsertOpenAiApiKey,
} from "../openai-platform.js";

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
    CREATE TABLE ai_agent_accounts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT,
      provider_user_id TEXT,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      scopes_json TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db as unknown as AppDatabase;
}

describe("three-vault owner_kind scope", () => {
  it("isolates platform, user, and agent secrets", () => {
    const db = tenantDb();
    createSecret(db, "shared_name", "platform-value", { kind: "platform" });
    createSecret(db, "shared_name", "user-value", { kind: "user" });
    createSecret(db, "shared_name", "agent-a-value", {
      kind: "agent",
      agentId: "agent-a",
    });
    createSecret(db, "shared_name", "agent-b-value", {
      kind: "agent",
      agentId: "agent-b",
    });

    expect(listSecrets(db, { kind: "platform" })).toHaveLength(1);
    expect(listSecrets(db, { kind: "user" })).toHaveLength(1);
    expect(listSecrets(db, { kind: "agent", agentId: "agent-a" })).toHaveLength(
      1
    );
    expect(listSecrets(db, { kind: "agent", agentId: "agent-b" })).toHaveLength(
      1
    );

    expect(resolveSecretByName(db, "shared_name", "agent-a")).toBe(
      "agent-a-value"
    );
    expect(resolveSecretByName(db, "shared_name", "agent-b")).toBe(
      "agent-b-value"
    );
    expect(resolveSecretByName(db, "shared_name", null)).toBe("platform-value");

    const aRow = findSecretByName(db, "shared_name", {
      kind: "agent",
      agentId: "agent-a",
    })!;
    expect(getSecretValueForAgent(db, aRow.id, "agent-b")).toBeNull();
    expect(getSecretValueForAgent(db, aRow.id, "agent-a")).toBe(
      "agent-a-value"
    );

    const userRow = findSecretByName(db, "shared_name", { kind: "user" })!;
    expect(getSecretValueForAgent(db, userRow.id, "agent-a")).toBeNull();
  });

  it("falls back from agent Vault to Platform (not User) for resolve", () => {
    const db = tenantDb();
    createSecret(db, OPENAI_API_KEY_SECRET_NAME, "sk-user-only", {
      kind: "user",
    });
    expect(resolveOpenAiApiKey(db, "intelligence")).toBeNull();

    upsertOpenAiApiKey(db, "sk-platform", null);
    expect(resolveOpenAiApiKey(db, "intelligence")).toBe("sk-platform");

    upsertOpenAiApiKey(db, "sk-agent", "intelligence");
    expect(resolveOpenAiApiKey(db, "intelligence")).toBe("sk-agent");
    expect(
      getPlatformVaultSecretInScope(db, {
        baseId: OPENAI_API_KEY_SECRET_ID,
        name: OPENAI_API_KEY_SECRET_NAME,
        agentId: "other-agent",
      })
    ).toBeNull();
    expect(resolveOpenAiApiKey(db, "other-agent")).toBe("sk-platform");
  });

  it("keeps fixed platform ids unique per owner", () => {
    const db = tenantDb();
    upsertPlatformVaultSecret(db, {
      baseId: OPENAI_API_KEY_SECRET_ID,
      name: OPENAI_API_KEY_SECRET_NAME,
      value: "platform",
      agentId: null,
    });
    upsertPlatformVaultSecret(db, {
      baseId: OPENAI_API_KEY_SECRET_ID,
      name: OPENAI_API_KEY_SECRET_NAME,
      value: "agent",
      agentId: "digital-you",
    });
    expect(platformVaultSecretId(OPENAI_API_KEY_SECRET_ID, null)).toBe(
      OPENAI_API_KEY_SECRET_ID
    );
    expect(platformVaultSecretId(OPENAI_API_KEY_SECRET_ID, "digital-you")).toBe(
      "openai-api-key__agent__digital-you"
    );
    expect(
      resolvePlatformVaultSecret(db, {
        baseId: OPENAI_API_KEY_SECRET_ID,
        name: OPENAI_API_KEY_SECRET_NAME,
        agentId: "digital-you",
      })
    ).toBe("agent");
    expect(
      resolveSecretRefForAgent(db, OPENAI_API_KEY_SECRET_ID, "digital-you")
    ).toBe("agent");
  });

  it("rejects duplicate names within the same owner", () => {
    const db = tenantDb();
    createSecret(db, "dup", "one", { kind: "platform" });
    expect(() => createSecret(db, "dup", "two", { kind: "platform" })).toThrow(
      /already exists/i
    );
    createSecret(db, "dup", "user-ok", { kind: "user" });
    createSecret(db, "dup", "agent-ok", { kind: "agent", agentId: "agent-a" });
  });

  it("deletes only within the requested owner scope", () => {
    const db = tenantDb();
    const platform = createSecret(db, "x", "p", { kind: "platform" });
    const agent = createSecret(db, "x", "a", {
      kind: "agent",
      agentId: "agent-a",
    });
    expect(deleteSecret(db, platform.id, { kind: "platform" })).toBe(true);
    expect(listSecrets(db, { kind: "platform" })).toHaveLength(0);
    expect(listSecrets(db, { kind: "agent", agentId: "agent-a" })).toHaveLength(
      1
    );
    expect(
      deleteSecret(db, agent.id, { kind: "agent", agentId: "agent-a" })
    ).toBe(true);
  });

  it("resolveExaApiKey uses agent Vault then Platform (not User)", () => {
    const db = tenantDb();
    createSecret(db, "exa_api_key", "user-exa", { kind: "user" });
    expect(resolveExaApiKey(db, "intelligence")).toBeNull();

    createSecret(db, "exa_api_key", "platform-exa", { kind: "platform" });
    expect(resolveExaApiKey(db, "intelligence")).toBe("platform-exa");
    createSecret(db, "exa_api_key", "agent-exa", {
      kind: "agent",
      agentId: "intelligence",
    });
    expect(resolveExaApiKey(db, "intelligence")).toBe("agent-exa");
    expect(resolveExaApiKey(db, "other")).toBe("platform-exa");
  });
});
