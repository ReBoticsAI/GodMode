/**
 * Auth security HTTP integration tests (issue #50).
 * Mounts createAuthRouter + CSRF + SaaS email gate against an in-memory core DB.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { HOLDINGS_KEY, ALLOWED_ORIGIN, mailCalls, mem } = vi.hoisted(() => {
  // require is available under vitest; must stay inside hoisted (no ESM imports).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(":memory:");
  db.pragma("foreign_keys = ON");
  return {
    HOLDINGS_KEY: "a".repeat(64),
    ALLOWED_ORIGIN: "https://app.example.com",
    mailCalls: [] as Array<{ to: string; subject: string; text: string }>,
    mem: db as import("better-sqlite3").Database,
  };
});

vi.mock("../../../core-db.js", async () => {
  const actual = await vi.importActual<typeof import("../../../core-db.js")>(
    "../../../core-db.js"
  );
  return {
    ...actual,
    getCoreDb: () => mem,
  };
});

vi.mock("../../../config.js", () => ({
  config: {
    isSaas: true,
    isHub: true,
    isClient: false,
    isProduction: false,
    dataDir: "/tmp/godmode-auth-test",
    auth: {
      sessionTtlDays: 7,
      allowSignup: false,
      inviteCodes: [] as string[],
      publicUrl: "https://api.example.com",
      initialAdminPassword: "",
    },
    web: {
      publicUrl: ALLOWED_ORIGIN,
      allowedOrigins: [ALLOWED_ORIGIN],
    },
    holdings: {
      secretKey: HOLDINGS_KEY,
      secretKeyPath: "/tmp/godmode-auth-test/holdings.key",
    },
    oauth: {
      google: { clientId: "g-client", clientSecret: "g-secret" },
      github: { clientId: "gh-client", clientSecret: "gh-secret" },
    },
    saas: {
      webhookSecret: "whsec_test",
      checkoutMode: "subscription",
      plans: [],
    },
  },
}));

vi.mock("../mailer.js", () => ({
  sendMail: vi.fn(async (msg: { to: string; subject: string; text: string }) => {
    mailCalls.push(msg);
  }),
  verificationEmail: (opts: { to: string; link: string }) => ({
    to: opts.to,
    subject: "Verify",
    text: opts.link,
    html: opts.link,
  }),
  resetPasswordEmail: (opts: { to: string; link: string }) => ({
    to: opts.to,
    subject: "Reset",
    text: opts.link,
    html: opts.link,
  }),
}));

import { hashPassword } from "../password.js";
import {
  beginMfaEnroll,
  confirmMfaEnroll,
  ensureAuthSecuritySchema,
  totpCode,
} from "../mfa-and-tokens.js";
import { createSession } from "../session-store.js";
import { attachAuthContext } from "../middleware.js";
import { requireTrustedOrigin } from "../rate-limit.js";
import { createAuthRouter } from "../../../routes/auth.js";
import { config } from "../../../config.js";
import { getCoreDb } from "../../../core-db.js";

function seedSchema(): void {
  mem.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      access_disabled INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      email_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TEXT,
      profile_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider, provider_user_id)
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_operator INTEGER NOT NULL DEFAULT 0,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
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
    CREATE TABLE IF NOT EXISTS saas_entitlements (
      id TEXT PRIMARY KEY,
      email TEXT,
      stripe_session_id TEXT NOT NULL UNIQUE,
      stripe_customer_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      consumed_at TEXT,
      consumed_by_user_id TEXT REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS saas_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      email TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT UNIQUE,
      stripe_session_id TEXT,
      plan_id TEXT,
      price_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      current_period_end TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      access_revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureAuthSecuritySchema(mem as never);
}

function insertUser(opts: {
  email: string;
  password: string;
  isAdmin?: boolean;
  verified?: boolean;
}): string {
  const id = randomUUID();
  mem
    .prepare(
      `INSERT INTO users (id, email, display_name, is_admin, password_hash, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      opts.email,
      opts.email.split("@")[0],
      opts.isAdmin ? 1 : 0,
      hashPassword(opts.password),
      opts.verified === false ? null : new Date().toISOString()
    );
  return id;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(requireTrustedOrigin);
  app.use("/api/auth", createAuthRouter());
  app.use("/api", attachAuthContext, (req, res, next) => {
    if (
      !config.isSaas ||
      !req.user ||
      req.user.emailVerified ||
      req.user.isAdmin
    ) {
      next();
      return;
    }
    const raw = (req.originalUrl || req.url || "").split("?")[0] ?? "";
    const p = raw.replace(/^\/api/, "") || req.path;
    if (
      p.startsWith("/auth") ||
      p.startsWith("/saas") ||
      p.includes("webhook") ||
      p === "/health" ||
      p.startsWith("/update")
    ) {
      next();
      return;
    }
    res.status(403).json({
      error: "Email verification required",
      code: "EMAIL_NOT_VERIFIED",
    });
  });
  app.get("/api/structure", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/api/structure", (_req, res) => {
    res.json({ ok: true, mutated: true });
  });
  app.post("/api/saas/webhook", (_req, res) => {
    res.json({ received: true });
  });
  return app;
}

async function withServer(
  app: express.Express,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = createServer(app as unknown as (req: IncomingMessage, res: ServerResponse) => void);
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

async function api(
  base: string,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    origin?: string;
    cookie?: string;
    authorization?: string;
  } = {}
): Promise<{ status: number; json: Record<string, unknown>; setCookie: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.authorization) headers.authorization = opts.authorization;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const setCookie = res.headers.get("set-cookie");
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  return { status: res.status, json, setCookie };
}

describe("auth security HTTP integration", () => {
  beforeEach(() => {
    seedSchema();
    for (const table of [
      "auth_tokens",
      "user_mfa",
      "sessions",
      "oauth_accounts",
      "rate_limit_buckets",
      "saas_entitlements",
      "saas_subscriptions",
      "tenant_memberships",
      "tenants",
      "users",
    ]) {
      try {
        mem.prepare(`DELETE FROM ${table}`).run();
      } catch {
        /* first bootstrap */
      }
    }
    mailCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verify-email happy path and opaque request-verification", async () => {
    insertUser({
      email: "verify@example.com",
      password: "secret12",
      verified: false,
    });
    const app = buildApp();
    await withServer(app, async (base) => {
      const opaqueMissing = await api(base, "POST", "/api/auth/request-verification", {
        body: { email: "nobody@example.com" },
        origin: ALLOWED_ORIGIN,
      });
      expect(opaqueMissing.status).toBe(200);
      expect(opaqueMissing.json).toEqual({ ok: true });

      const opaque = await api(base, "POST", "/api/auth/request-verification", {
        body: { email: "verify@example.com" },
        origin: ALLOWED_ORIGIN,
      });
      expect(opaque.status).toBe(200);
      expect(opaque.json).toEqual({ ok: true });
      await new Promise((r) => setTimeout(r, 50));
      expect(mailCalls.some((m) => m.to === "verify@example.com")).toBe(true);
      const link = mailCalls.find((m) => m.to === "verify@example.com")!.text;
      const token = new URL(link).searchParams.get("verify")!;
      expect(token).toBeTruthy();

      const verified = await api(base, "POST", "/api/auth/verify-email", {
        body: { token },
        origin: ALLOWED_ORIGIN,
      });
      expect(verified.status).toBe(200);
      expect(verified.json).toEqual({ ok: true });
      const row = getCoreDb()
        .prepare(`SELECT email_verified_at FROM users WHERE email=?`)
        .get("verify@example.com") as { email_verified_at: string | null };
      expect(row.email_verified_at).toBeTruthy();
    });
  });

  it("forgot/reset-password happy path with opaque forgot", async () => {
    insertUser({
      email: "reset@example.com",
      password: "oldpass1",
      isAdmin: true,
    });
    const app = buildApp();
    await withServer(app, async (base) => {
      const forgotMissing = await api(base, "POST", "/api/auth/forgot-password", {
        body: { email: "ghost@example.com" },
        origin: ALLOWED_ORIGIN,
      });
      expect(forgotMissing.status).toBe(200);
      expect(forgotMissing.json).toEqual({ ok: true });

      const forgot = await api(base, "POST", "/api/auth/forgot-password", {
        body: { email: "reset@example.com" },
        origin: ALLOWED_ORIGIN,
      });
      expect(forgot.status).toBe(200);
      await new Promise((r) => setTimeout(r, 50));
      const link = mailCalls.find((m) => m.to === "reset@example.com")!.text;
      const token = new URL(link).searchParams.get("reset")!;

      const reset = await api(base, "POST", "/api/auth/reset-password", {
        body: { token, newPassword: "newpass9" },
        origin: ALLOWED_ORIGIN,
      });
      expect(reset.status).toBe(200);

      const loginOld = await api(base, "POST", "/api/auth/login", {
        body: { email: "reset@example.com", password: "oldpass1" },
        origin: ALLOWED_ORIGIN,
      });
      expect(loginOld.status).toBe(401);

      const loginNew = await api(base, "POST", "/api/auth/login", {
        body: { email: "reset@example.com", password: "newpass9" },
        origin: ALLOWED_ORIGIN,
      });
      expect(loginNew.status).toBe(200);
      expect(loginNew.json.sessionToken).toBeTruthy();
    });
  });

  it("MFA enroll → login step-up → TOTP and recovery code", async () => {
    const userId = insertUser({
      email: "mfa@example.com",
      password: "secret12",
      isAdmin: true,
    });
    const core = getCoreDb();
    const enroll = beginMfaEnroll(core, userId, "mfa@example.com");
    expect(confirmMfaEnroll(core, userId, totpCode(enroll.secretBase32))).toBe(true);
    const recoveryCode = enroll.recoveryCodes[0]!;

    const app = buildApp();
    await withServer(app, async (base) => {
      const login = await api(base, "POST", "/api/auth/login", {
        body: { email: "mfa@example.com", password: "secret12" },
        origin: ALLOWED_ORIGIN,
      });
      expect(login.status).toBe(200);
      expect(login.json.mfaRequired).toBe(true);
      const mfaToken = login.json.mfaToken as string;

      const good = await api(base, "POST", "/api/auth/mfa/verify-login", {
        body: { mfaToken, code: totpCode(enroll.secretBase32) },
        origin: ALLOWED_ORIGIN,
      });
      expect(good.status).toBe(200);
      expect(good.json.sessionToken).toBeTruthy();

      const login2 = await api(base, "POST", "/api/auth/login", {
        body: { email: "mfa@example.com", password: "secret12" },
        origin: ALLOWED_ORIGIN,
      });
      expect(login2.json.mfaRequired).toBe(true);
      const recovery = await api(base, "POST", "/api/auth/mfa/verify-login", {
        body: { mfaToken: login2.json.mfaToken, code: recoveryCode },
        origin: ALLOWED_ORIGIN,
      });
      expect(recovery.status).toBe(200);
      expect(recovery.json.sessionToken).toBeTruthy();
    });
  });

  it("CSRF rejects untrusted Origin; allows webhook and Bearer-only", async () => {
    insertUser({ email: "csrf@example.com", password: "secret12", isAdmin: true });
    const app = buildApp();
    await withServer(app, async (base) => {
      const rejected = await api(base, "POST", "/api/auth/login", {
        body: { email: "csrf@example.com", password: "secret12" },
        origin: "https://evil.example",
      });
      expect(rejected.status).toBe(403);
      expect(rejected.json.error).toBe("Untrusted Origin");

      const webhook = await api(base, "POST", "/api/saas/webhook", {
        body: {},
        origin: "https://evil.example",
      });
      expect(webhook.status).toBe(200);

      const sessionId = createSession(
        getCoreDb(),
        insertUser({
          email: "bearer@example.com",
          password: "secret12",
          isAdmin: true,
        }),
        7
      );

      const cookieReject = await api(base, "POST", "/api/auth/logout", {
        cookie: `godmode_session=${sessionId}`,
        origin: "https://evil.example",
      });
      expect(cookieReject.status).toBe(403);

      const bearerOk = await api(base, "POST", "/api/structure", {
        authorization: `Bearer ${sessionId}`,
        body: {},
        origin: "https://evil.example",
      });
      expect(bearerOk.status).toBe(200);
      expect(bearerOk.json.mutated).toBe(true);
    });
  });

  it("SaaS email gate returns EMAIL_NOT_VERIFIED for product APIs", async () => {
    const userId = insertUser({
      email: "gate@example.com",
      password: "secret12",
      isAdmin: false,
      verified: false,
    });
    // Non-admins need an active subscription or attachAuthContext drops the session.
    getCoreDb()
      .prepare(
        `INSERT INTO saas_subscriptions (id, user_id, email, status, access_revoked)
         VALUES (?, ?, ?, 'active', 0)`
      )
      .run(randomUUID(), userId, "gate@example.com");
    const sessionId = createSession(getCoreDb(), userId, 7);
    const app = buildApp();
    await withServer(app, async (base) => {
      const blocked = await api(base, "GET", "/api/structure", {
        cookie: `godmode_session=${sessionId}`,
        origin: ALLOWED_ORIGIN,
      });
      expect(blocked.status).toBe(403);
      expect(blocked.json.code).toBe("EMAIL_NOT_VERIFIED");

      const authOk = await api(base, "GET", "/api/auth/me", {
        cookie: `godmode_session=${sessionId}`,
        origin: ALLOWED_ORIGIN,
      });
      expect(authOk.status).toBe(200);
    });
  });

  it("SaaS platform admins skip email verification gate", async () => {
    const userId = insertUser({
      email: "admin-gate@example.com",
      password: "secret12",
      isAdmin: true,
      verified: false,
    });
    const sessionId = createSession(getCoreDb(), userId, 7);
    const app = buildApp();
    await withServer(app, async (base) => {
      const ok = await api(base, "GET", "/api/structure", {
        cookie: `godmode_session=${sessionId}`,
        origin: ALLOWED_ORIGIN,
      });
      expect(ok.status).toBe(200);
      expect(ok.json.ok).toBe(true);
    });
  });

  it("OAuth callback link-or-create requires verified email (mocked IdP)", async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("googleapis.com/oauth2/v2/userinfo")) {
        return new Response(
          JSON.stringify({
            id: "google-user-1",
            email: "oauth@example.com",
            verified_email: true,
            name: "OAuth User",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return realFetch(input, init);
    });

    const userId = insertUser({
      email: "oauth@example.com",
      password: "secret12",
      isAdmin: true,
      verified: false,
    });

    const app = buildApp();
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/auth/oauth/google/callback?code=test-code`, {
        redirect: "manual",
      });
      expect([302, 303]).toContain(res.status);
      const location = res.headers.get("location") ?? "";
      expect(location.startsWith(ALLOWED_ORIGIN)).toBe(true);

      const linked = getCoreDb()
        .prepare(
          `SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_user_id=?`
        )
        .get("google", "google-user-1") as { user_id: string } | undefined;
      expect(linked?.user_id).toBe(userId);

      const verified = getCoreDb()
        .prepare(`SELECT email_verified_at FROM users WHERE id=?`)
        .get(userId) as { email_verified_at: string | null };
      expect(verified.email_verified_at).toBeTruthy();
    });
  });

  it("OAuth rejects unverified Google email", async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("userinfo")) {
        return new Response(
          JSON.stringify({
            id: "google-unverified",
            email: "bad@example.com",
            verified_email: false,
            name: "Bad",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return realFetch(input, init);
    });

    const app = buildApp();
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/auth/oauth/google/callback?code=test-code`);
      expect(res.status).toBe(502);
    });
  });
});
