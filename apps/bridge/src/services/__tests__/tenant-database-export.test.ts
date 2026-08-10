/**
 * Tenant workspace SQLite export (#235).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mem, tmpRoot, tenantsDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require("better-sqlite3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsH = require("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const osH = require("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pathH = require("node:path");
  const root = fsH.mkdtempSync(pathH.join(osH.tmpdir(), "gm-tenant-export-"));
  const tenants = pathH.join(root, "tenants");
  fsH.mkdirSync(tenants, { recursive: true });
  const db = new BetterSqlite3(":memory:");
  db.pragma("foreign_keys = ON");
  return {
    mem: db as import("better-sqlite3").Database,
    tmpRoot: root as string,
    tenantsDir: tenants as string,
  };
});

const tenantHandles = new Map<string, Database.Database>();

vi.mock("../../config.js", () => ({
  config: {
    isSaas: false,
    isHub: false,
    isClient: false,
    isProduction: false,
    dataDir: tmpRoot,
    tenantsDir,
    auth: {
      sessionTtlDays: 7,
      allowSignup: false,
      inviteCodes: [] as string[],
      publicUrl: "https://api.example.com",
      initialAdminPassword: "",
    },
    web: {
      publicUrl: "https://app.example.com",
      allowedOrigins: ["https://app.example.com"],
    },
    holdings: {
      secretKey: "a".repeat(64),
      secretKeyPath: `${tmpRoot}/holdings.key`,
    },
    ai: {
      defaultTemperature: 1,
      defaultTopP: 1,
      defaultTopK: 0,
      defaultMinP: 0,
      defaultRepeatPenalty: 1,
      defaultPresencePenalty: 0,
      defaultFrequencyPenalty: 0,
      defaultMaxTokens: 0,
      defaultSeed: null,
      defaultEnableThinking: false,
      defaultThinkingEfficiency: null,
      defaultNativeTools: false,
    },
  },
}));

vi.mock("../../core-db.js", async () => {
  const actual = await vi.importActual<typeof import("../../core-db.js")>(
    "../../core-db.js"
  );
  return {
    ...actual,
    getCloudDb: () => mem,
  };
});

vi.mock("../agents/user-agent.js", () => ({
  ensureUserAgent: vi.fn(),
}));

vi.mock("../../tenant-registry.js", () => ({
  getTenantDb: (tenantId: string) => {
    const existing = tenantHandles.get(tenantId);
    if (existing) return existing;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pathH = require("node:path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsH = require("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require("better-sqlite3");
    const filePath = pathH.join(tenantsDir, `${tenantId}.sqlite`);
    fsH.mkdirSync(tenantsDir, { recursive: true });
    const db = new BetterSqlite3(filePath);
    tenantHandles.set(tenantId, db);
    return db;
  },
  evictTenantDb: (tenantId: string) => {
    const db = tenantHandles.get(tenantId);
    if (!db) return;
    try {
      db.close();
    } catch {
      /* ignore */
    }
    tenantHandles.delete(tenantId);
  },
}));

import { hashPassword } from "../auth/password.js";
import { createSession } from "../auth/session-store.js";
import { ensureAuthSecuritySchema } from "../auth/mfa-and-tokens.js";
import { createTenantDataRouter } from "../../routes/tenant-data.js";
import { getTenantDb, evictTenantDb } from "../../tenant-registry.js";
import {
  cleanupTenantSnapshot,
  createTenantDatabaseSnapshot,
  logTenantDatabaseDownloadAudit,
  sanitizeWorkspaceFilenameSlug,
} from "../tenant-database-export.js";

function ensureCoreSchema(): void {
  ensureAuthSecuritySchema(mem as never);
  mem.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      email_verified_at TEXT,
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_operator INTEGER NOT NULL DEFAULT 0,
      owner_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tenant_memberships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tenant_id)
    );
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );
  `);
}

function insertUser(email: string): string {
  const id = randomUUID();
  mem
    .prepare(
      `INSERT INTO users (id, email, display_name, is_admin, password_hash, email_verified_at)
       VALUES (?, ?, ?, 0, ?, datetime('now'))`
    )
    .run(id, email, email.split("@")[0], hashPassword("secret12"));
  return id;
}

function insertTenant(opts: {
  id: string;
  slug: string;
  ownerUserId: string;
}): void {
  mem
    .prepare(
      `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(opts.id, opts.slug, opts.slug, opts.ownerUserId);
}

function insertMembership(
  userId: string,
  tenantId: string,
  role: "owner" | "editor" | "viewer"
): void {
  mem
    .prepare(
      `INSERT INTO tenant_memberships (user_id, tenant_id, role) VALUES (?, ?, ?)`
    )
    .run(userId, tenantId, role);
}

function seedMarker(tenantId: string, marker: string): void {
  const db = getTenantDb(tenantId);
  db.exec(`CREATE TABLE IF NOT EXISTS export_marker (v TEXT NOT NULL)`);
  db.prepare(`DELETE FROM export_marker`).run();
  db.prepare(`INSERT INTO export_marker (v) VALUES (?)`).run(marker);
}

async function withServer(
  app: express.Express,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = createServer(
    app as unknown as (req: IncomingMessage, res: ServerResponse) => void
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

describe("tenant-database-export", () => {
  beforeEach(() => {
    for (const id of [...tenantHandles.keys()]) {
      evictTenantDb(id);
    }
    ensureCoreSchema();
    mem.exec(`
      DELETE FROM tenant_memberships;
      DELETE FROM tenants;
      DELETE FROM sessions;
      DELETE FROM users;
      DELETE FROM rate_limit_buckets;
      DROP TABLE IF EXISTS platform_action_log;
    `);
    fs.rmSync(tenantsDir, { recursive: true, force: true });
    fs.mkdirSync(tenantsDir, { recursive: true });
  });

  afterEach(() => {
    for (const id of [...tenantHandles.keys()]) {
      evictTenantDb(id);
    }
  });

  it("sanitizes download filename slugs", () => {
    expect(sanitizeWorkspaceFilenameSlug("acme-co")).toBe("acme-co");
    expect(sanitizeWorkspaceFilenameSlug("../etc")).toBe("_etc");
    expect(sanitizeWorkspaceFilenameSlug("")).toBe("workspace");
  });

  it("creates a verified SQLite snapshot distinct from the live handle", async () => {
    insertUser("o@example.com");
    const ownerId = (
      mem.prepare(`SELECT id FROM users WHERE email=?`).get("o@example.com") as {
        id: string;
      }
    ).id;
    insertTenant({
      id: "tenant-a",
      slug: "acme",
      ownerUserId: ownerId,
    });
    seedMarker("tenant-a", "marker-a");
    const live = getTenantDb("tenant-a");
    const snap = await createTenantDatabaseSnapshot(live as never);
    try {
      expect(snap.bytes).toBeGreaterThan(0);
      expect(fs.existsSync(snap.filePath)).toBe(true);
      const check = new Database(snap.filePath, { readonly: true });
      try {
        const row = check.prepare(`SELECT v FROM export_marker`).get() as {
          v: string;
        };
        expect(row.v).toBe("marker-a");
      } finally {
        check.close();
      }
    } finally {
      cleanupTenantSnapshot(snap.filePath);
    }
  });

  it("writes core audit rows for downloads", () => {
    logTenantDatabaseDownloadAudit(mem as never, {
      userId: "u1",
      tenantId: "t1",
      bytes: 1234,
      result: "ok",
    });
    const row = mem
      .prepare(
        `SELECT agent_id, action, scope, result FROM platform_action_log LIMIT 1`
      )
      .get() as {
      agent_id: string;
      action: string;
      scope: string;
      result: string;
    };
    expect(row.action).toBe("tenant.database.download");
    expect(row.scope).toBe("tenant:t1");
    expect(row.agent_id).toBe("user:u1");
    expect(row.result).toBe("ok");
  });

  it("router gates download behind owner role + rate limit + audit", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const routePath = fileURLToPath(
      new URL("../../routes/tenant-data.ts", import.meta.url)
    );
    const text = readFileSync(routePath, "utf8");
    expect(text).toMatch(/requireTenantRole\("owner"\)/);
    expect(text).toMatch(
      /router\.use\(attachAuthContext,\s*requireAuth,\s*resolveTenant\)/
    );
    expect(text).toMatch(/database\/download/);
    expect(text).toMatch(/tenantDbDownloadLimiter/);
    expect(text).toMatch(/logTenantDatabaseDownloadAudit/);
    expect(text).toMatch(/createTenantDatabaseSnapshot/);
  });

  it("owner can download; viewer and other tenant cannot access foreign data", async () => {
    const ownerA = insertUser("owner-a@example.com");
    const viewerA = insertUser("viewer-a@example.com");
    const ownerB = insertUser("owner-b@example.com");
    insertTenant({ id: "tenant-a", slug: "alpha", ownerUserId: ownerA });
    insertTenant({ id: "tenant-b", slug: "beta", ownerUserId: ownerB });
    insertMembership(ownerA, "tenant-a", "owner");
    insertMembership(viewerA, "tenant-a", "viewer");
    insertMembership(ownerB, "tenant-b", "owner");
    seedMarker("tenant-a", "SECRET-A");
    seedMarker("tenant-b", "SECRET-B");

    const app = express();
    app.use("/api/tenant", createTenantDataRouter());

    await withServer(app, async (base) => {
      const sessionA = createSession(mem as never, ownerA, 7);
      const sessionViewer = createSession(mem as never, viewerA, 7);
      const sessionB = createSession(mem as never, ownerB, 7);

      const unauth = await fetch(`${base}/api/tenant/database/download`, {
        headers: { "X-Tenant-Id": "tenant-a" },
      });
      expect(unauth.status).toBe(401);

      const viewerDenied = await fetch(`${base}/api/tenant/database/download`, {
        headers: {
          "X-Tenant-Id": "tenant-a",
          Authorization: `Bearer ${sessionViewer}`,
          "X-Godmode-Session": sessionViewer,
        },
      });
      expect(viewerDenied.status).toBe(403);

      const ownerOk = await fetch(`${base}/api/tenant/database/download`, {
        headers: {
          "X-Tenant-Id": "tenant-a",
          Authorization: `Bearer ${sessionA}`,
          "X-Godmode-Session": sessionA,
        },
      });
      expect(ownerOk.status).toBe(200);
      expect(ownerOk.headers.get("Cache-Control")).toBe("no-store");
      const cd = ownerOk.headers.get("Content-Disposition") ?? "";
      expect(cd).toMatch(/godmode-workspace-alpha\.sqlite/);
      const buf = Buffer.from(await ownerOk.arrayBuffer());
      expect(buf.byteLength).toBeGreaterThan(0);
      const tmp = path.join(tmpRoot, "dl-a.sqlite");
      fs.writeFileSync(tmp, buf);
      const opened = new Database(tmp, { readonly: true });
      try {
        const row = opened.prepare(`SELECT v FROM export_marker`).get() as {
          v: string;
        };
        expect(row.v).toBe("SECRET-A");
        expect(row.v).not.toBe("SECRET-B");
      } finally {
        opened.close();
      }

      // Non-member of A with X-Tenant-Id=A falls back to own tenant (B).
      const cross = await fetch(`${base}/api/tenant/database/download`, {
        headers: {
          "X-Tenant-Id": "tenant-a",
          Authorization: `Bearer ${sessionB}`,
          "X-Godmode-Session": sessionB,
        },
      });
      expect(cross.status).toBe(200);
      const crossBuf = Buffer.from(await cross.arrayBuffer());
      const tmpB = path.join(tmpRoot, "dl-b.sqlite");
      fs.writeFileSync(tmpB, crossBuf);
      const openedB = new Database(tmpB, { readonly: true });
      try {
        const row = openedB.prepare(`SELECT v FROM export_marker`).get() as {
          v: string;
        };
        expect(row.v).toBe("SECRET-B");
      } finally {
        openedB.close();
      }

      const audit = mem
        .prepare(
          `SELECT COUNT(*) AS n FROM platform_action_log
           WHERE action='tenant.database.download' AND result='ok'`
        )
        .get() as { n: number };
      expect(audit.n).toBeGreaterThanOrEqual(1);
      const scopes = mem
        .prepare(
          `SELECT scope FROM platform_action_log
           WHERE action='tenant.database.download' AND result='ok'`
        )
        .all() as Array<{ scope: string }>;
      expect(scopes.some((s) => s.scope === "tenant:tenant-a")).toBe(true);
    });
  });
});
