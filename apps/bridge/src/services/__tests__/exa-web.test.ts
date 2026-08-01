/**
 * Exa BYOK web tools (#218).
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: {
    isSaas: false,
    isHub: false,
    dataDir: process.cwd(),
    holdings: { secretKey: "a".repeat(64), secretKeyPath: "/tmp/unused-holdings.key" },
  },
}));

import { config } from "../../config.js";
import type { AppDatabase } from "../../db.js";
import { createAgentApiKeyAccount } from "../agents/agent-accounts.js";
import { createSecret } from "../agents/agents-db.js";
import {
  cloudRequiresExaByok,
  creditsExhaustedMessage,
  exaFetchUrl,
  exaWebSearch,
  missingExaKeyMessage,
  resolveExaApiKey,
} from "../exa-web.js";

const cfg = config as { isSaas: boolean };

function tenantDb(): AppDatabase {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ai_secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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

describe("resolveExaApiKey", () => {
  it("prefers agent account provider exa over Vault", () => {
    const db = tenantDb();
    createSecret(db, "exa_api_key", "vault-exa-key");
    createAgentApiKeyAccount(db, {
      agentId: "intelligence",
      provider: "exa",
      apiKey: "agent-exa-key",
    });
    expect(resolveExaApiKey(db, "intelligence")).toBe("agent-exa-key");
  });

  it("falls back to Vault secret name exa_api_key", () => {
    const db = tenantDb();
    createSecret(db, "exa_api_key", "vault-exa-key");
    expect(resolveExaApiKey(db, "intelligence")).toBe("vault-exa-key");
  });

  it("matches Vault name case-insensitively", () => {
    const db = tenantDb();
    createSecret(db, "Exa_API_Key", "vault-mixed");
    expect(resolveExaApiKey(db, "intelligence")).toBe("vault-mixed");
  });

  it("returns null when no key is configured", () => {
    const db = tenantDb();
    expect(resolveExaApiKey(db, "intelligence")).toBeNull();
  });
});

describe("cloudRequiresExaByok", () => {
  afterEach(() => {
    cfg.isSaas = false;
  });

  it("is true only on SaaS", () => {
    cfg.isSaas = false;
    expect(cloudRequiresExaByok()).toBe(false);
    cfg.isSaas = true;
    expect(cloudRequiresExaByok()).toBe(true);
  });
});

describe("exa API helpers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("maps search results from Exa /search", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Example",
              url: "https://example.com",
              highlights: ["hello world"],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const out = await exaWebSearch("test-key", { query: "hello", limit: 5 });
    expect(out.provider).toBe("exa");
    expect(out.results).toEqual([
      { title: "Example", url: "https://example.com", snippet: "hello world" },
    ]);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain("https://api.exa.ai/search");
    expect(call[1].headers.Authorization).toBe("Bearer test-key");
  });

  it("maps contents from Exa /contents", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Doc",
              url: "https://example.com/doc",
              text: "body text here",
            },
          ],
          statuses: [{ status: "success" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const out = await exaFetchUrl("test-key", {
      url: "https://example.com/doc",
      maxChars: 100,
    });
    expect(out).toMatchObject({
      provider: "exa",
      title: "Doc",
      text: "body text here",
      truncated: false,
    });
  });

  it("hard-fails on exhausted credits without retrying", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: "insufficient credits" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      exaWebSearch("dead-key", { query: "x", limit: 3 })
    ).rejects.toMatchObject({
      kind: "credits",
      message: creditsExhaustedMessage(),
    });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("hard-fails on auth errors", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("unauthorized", { status: 401 })
    );
    await expect(
      exaFetchUrl("bad-key", { url: "https://example.com", maxChars: 1000 })
    ).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("missing key copy", () => {
  it("mentions signup and Vault / agent paste path", () => {
    const msg = missingExaKeyMessage();
    expect(msg).toMatch(/dashboard\.exa\.ai/i);
    expect(msg).toMatch(/exa_api_key/);
    expect(msg).toMatch(/no shared platform/i);
  });
});
