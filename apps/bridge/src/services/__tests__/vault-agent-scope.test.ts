/**
 * Per-agent Vault scope isolation + personal fallback (#330 slice 1).
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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX ai_secrets_name_personal_uq
      ON ai_secrets(name) WHERE agent_id IS NULL;
    CREATE UNIQUE INDEX ai_secrets_name_agent_uq
      ON ai_secrets(name, agent_id) WHERE agent_id IS NOT NULL;
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

describe("per-agent Vault scope", () => {
  it("isolates secrets by owner and blocks cross-agent reads", () => {
    const db = tenantDb();
    createSecret(db, "shared_name", "personal-value", null);
    createSecret(db, "shared_name", "agent-a-value", "agent-a");
    createSecret(db, "shared_name", "agent-b-value", "agent-b");

    expect(listSecrets(db, null)).toHaveLength(1);
    expect(listSecrets(db, "agent-a")).toHaveLength(1);
    expect(listSecrets(db, "agent-b")).toHaveLength(1);

    expect(resolveSecretByName(db, "shared_name", "agent-a")).toBe("agent-a-value");
    expect(resolveSecretByName(db, "shared_name", "agent-b")).toBe("agent-b-value");
    expect(resolveSecretByName(db, "shared_name", null)).toBe("personal-value");

    const aRow = findSecretByName(db, "shared_name", "agent-a")!;
    expect(getSecretValueForAgent(db, aRow.id, "agent-b")).toBeNull();
    expect(getSecretValueForAgent(db, aRow.id, "agent-a")).toBe("agent-a-value");
  });

  it("falls back from agent Vault to Personal for resolve", () => {
    const db = tenantDb();
    upsertOpenAiApiKey(db, "sk-personal", null);
    expect(resolveOpenAiApiKey(db, "intelligence")).toBe("sk-personal");

    upsertOpenAiApiKey(db, "sk-agent", "intelligence");
    expect(resolveOpenAiApiKey(db, "intelligence")).toBe("sk-agent");
    expect(
      getPlatformVaultSecretInScope(db, {
        baseId: OPENAI_API_KEY_SECRET_ID,
        name: OPENAI_API_KEY_SECRET_NAME,
        agentId: "other-agent",
      })
    ).toBeNull();
    expect(resolveOpenAiApiKey(db, "other-agent")).toBe("sk-personal");
  });

  it("keeps fixed platform ids unique per owner", () => {
    const db = tenantDb();
    upsertPlatformVaultSecret(db, {
      baseId: OPENAI_API_KEY_SECRET_ID,
      name: OPENAI_API_KEY_SECRET_NAME,
      value: "personal",
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
    createSecret(db, "dup", "one", null);
    expect(() => createSecret(db, "dup", "two", null)).toThrow(/already exists/i);
    createSecret(db, "dup", "agent-ok", "agent-a");
  });

  it("deletes only within the requested owner scope", () => {
    const db = tenantDb();
    const personal = createSecret(db, "x", "p", null);
    const agent = createSecret(db, "x", "a", "agent-a");
    expect(deleteSecret(db, personal.id, null)).toBe(true);
    expect(listSecrets(db, null)).toHaveLength(0);
    expect(listSecrets(db, "agent-a")).toHaveLength(1);
    expect(deleteSecret(db, agent.id, "agent-a")).toBe(true);
  });

  it("resolveExaApiKey uses agent Vault then Personal", () => {
    const db = tenantDb();
    createSecret(db, "exa_api_key", "personal-exa", null);
    expect(resolveExaApiKey(db, "intelligence")).toBe("personal-exa");
    createSecret(db, "exa_api_key", "agent-exa", "intelligence");
    expect(resolveExaApiKey(db, "intelligence")).toBe("agent-exa");
    expect(resolveExaApiKey(db, "other")).toBe("personal-exa");
  });
});
