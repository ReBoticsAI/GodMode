import { createHash, randomBytes } from "node:crypto";
import type { CoreDatabase, CoreUser } from "../core-db.js";
import { getCloudDb } from "../core-db.js";
import { config } from "../config.js";
import { coreUserToAuth, type AuthenticatedUser } from "../types/express-auth.js";
import { githubProjectsStatus } from "./github-integration.js";
import { getSellerPayoutSnapshot } from "./marketplace-commerce.js";
import { getUserDb } from "../user-registry.js";

const DEVICE_TTL_MS = 15 * 60 * 1000;
const REDIRECT_TTL_MS = 30 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 5;
const TOKEN_PREFIX = "gsl_";
const EXCHANGE_PREFIX = "slx_";

export type SellerLinkDeviceStart = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
};

export type SellerLinkPollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "complete"; accessToken: string; tokenType: "Bearer" };

export type SellerLinkRedirectStart = {
  state: string;
  connectUrl: string;
  expiresIn: number;
};

export type SellerLinkRedirectSession = {
  state: string;
  returnUrl: string;
  status: string;
  expiresAt: string;
};

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function makeUserCode(): string {
  // Avoid ambiguous chars (0/O, 1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
    if (i === 3) out += "-";
  }
  return out;
}

export function ensureSellerLinkSchema(db: CoreDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seller_link_devices (
      device_code_hash TEXT PRIMARY KEY,
      user_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS seller_link_devices_user_code_idx
      ON seller_link_devices(user_code);
    CREATE TABLE IF NOT EXISTS seller_link_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_code_hash TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS seller_link_tokens_user_idx
      ON seller_link_tokens(user_id);
    CREATE TABLE IF NOT EXISTS seller_link_redirects (
      state_hash TEXT PRIMARY KEY,
      return_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      exchange_code_hash TEXT UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS seller_link_redirects_exchange_idx
      ON seller_link_redirects(exchange_code_hash);
  `);
}

/** Local return URLs: localhost / 127.0.0.1 (any port) or same-origin Cloud public URL. */
export function assertSellerLinkReturnUrl(returnUrlRaw: string): string {
  const trimmed = returnUrlRaw.trim();
  if (!trimmed) {
    throw Object.assign(new Error("return_url required"), { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw Object.assign(new Error("return_url must be a valid URL"), { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw Object.assign(new Error("return_url must be http or https"), { status: 400 });
  }
  const host = url.hostname.toLowerCase();
  const publicBase = (config.web.publicUrl || "").replace(/\/$/, "");
  let publicHost = "";
  try {
    publicHost = publicBase ? new URL(publicBase).hostname.toLowerCase() : "";
  } catch {
    publicHost = "";
  }
  const localOk =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1";
  const cloudOk = Boolean(publicHost) && host === publicHost;
  if (!localOk && !cloudOk) {
    throw Object.assign(
      new Error("return_url must use localhost or the Cloud app origin"),
      { status: 400 }
    );
  }
  return url.toString();
}

export function startSellerLinkRedirect(returnUrlRaw: string): SellerLinkRedirectStart {
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const returnUrl = assertSellerLinkReturnUrl(returnUrlRaw);
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + REDIRECT_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO seller_link_redirects (state_hash, return_url, status, expires_at)
     VALUES (?, ?, 'pending', ?)`
  ).run(hashToken(state), returnUrl, expiresAt);

  const publicBase = config.web.publicUrl.replace(/\/$/, "") || "https://app.godmode.software";
  return {
    state,
    connectUrl: `${publicBase}/seller-link/connect?state=${encodeURIComponent(state)}`,
    expiresIn: Math.floor(REDIRECT_TTL_MS / 1000),
  };
}

function loadRedirectByState(stateRaw: string): {
  state_hash: string;
  return_url: string;
  status: string;
  expires_at: string;
  user_id: string | null;
  exchange_code_hash: string | null;
} {
  const state = stateRaw.trim();
  if (!state) {
    throw Object.assign(new Error("state required"), { status: 400 });
  }
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const row = db
    .prepare(`SELECT * FROM seller_link_redirects WHERE state_hash=?`)
    .get(hashToken(state)) as
    | {
        state_hash: string;
        return_url: string;
        status: string;
        expires_at: string;
        user_id: string | null;
        exchange_code_hash: string | null;
      }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Unknown seller link state"), { status: 404 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    if (row.status !== "expired" && row.status !== "complete") {
      db.prepare(
        `UPDATE seller_link_redirects SET status='expired' WHERE state_hash=?`
      ).run(row.state_hash);
    }
    throw Object.assign(new Error("Seller link session expired"), { status: 410 });
  }
  return row;
}

export function getSellerLinkRedirectSession(stateRaw: string): SellerLinkRedirectSession {
  const row = loadRedirectByState(stateRaw);
  return {
    state: stateRaw.trim(),
    returnUrl: row.return_url,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

/**
 * After Cloud auth (+ optional Seller checkout), mint a one-time exchange code
 * and return the Local return URL with seller_link_exchange query.
 */
export function completeSellerLinkRedirect(
  userId: string,
  stateRaw: string
): { redirectUrl: string; exchangeCode: string } {
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const row = loadRedirectByState(stateRaw);
  if (row.status === "complete") {
    throw Object.assign(new Error("Seller link already completed"), { status: 409 });
  }
  if (row.status !== "pending" && row.status !== "ready") {
    throw Object.assign(new Error("Seller link session is not pending"), { status: 409 });
  }

  const exchangeCode = `${EXCHANGE_PREFIX}${randomBytes(24).toString("base64url")}`;
  db.prepare(
    `UPDATE seller_link_redirects
     SET status='ready', user_id=?, exchange_code_hash=?, completed_at=datetime('now')
     WHERE state_hash=?`
  ).run(userId, hashToken(exchangeCode), row.state_hash);

  const redirect = new URL(row.return_url);
  redirect.searchParams.set("seller_link_exchange", exchangeCode);
  if (!redirect.searchParams.get("tab")) {
    redirect.searchParams.set("tab", "seller");
  }
  return { redirectUrl: redirect.toString(), exchangeCode };
}

/** Local Bridge exchanges one-time code for a durable gsl_ bearer token. */
export function exchangeSellerLinkCode(exchangeCodeRaw: string): {
  accessToken: string;
  tokenType: "Bearer";
} {
  const exchangeCode = exchangeCodeRaw.trim();
  if (!exchangeCode.startsWith(EXCHANGE_PREFIX)) {
    throw Object.assign(new Error("Invalid exchange code"), { status: 400 });
  }
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const row = db
    .prepare(`SELECT * FROM seller_link_redirects WHERE exchange_code_hash=?`)
    .get(hashToken(exchangeCode)) as
    | {
        state_hash: string;
        status: string;
        expires_at: string;
        user_id: string | null;
      }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Unknown exchange code"), { status: 404 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("Exchange code expired"), { status: 410 });
  }
  if (row.status !== "ready" || !row.user_id) {
    throw Object.assign(new Error("Exchange code already used or not ready"), { status: 409 });
  }

  const accessToken = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  db.prepare(
    `INSERT INTO seller_link_tokens (token_hash, user_id, device_code_hash)
     VALUES (?, ?, NULL)`
  ).run(hashToken(accessToken), row.user_id);
  db.prepare(
    `UPDATE seller_link_redirects
     SET status='complete', exchange_code_hash=NULL
     WHERE state_hash=?`
  ).run(row.state_hash);
  return { accessToken, tokenType: "Bearer" };
}

export function startSellerLinkDevice(): SellerLinkDeviceStart {
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const deviceCode = randomBytes(32).toString("base64url");
  const userCode = makeUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO seller_link_devices (device_code_hash, user_code, status, expires_at)
     VALUES (?, ?, 'pending', ?)`
  ).run(hashToken(deviceCode), userCode, expiresAt);

  const publicBase = config.web.publicUrl.replace(/\/$/, "") || "https://app.godmode.software";
  return {
    deviceCode,
    userCode,
    verificationUrl: `${publicBase}/marketplace?tab=seller&seller_link=${encodeURIComponent(userCode)}`,
    expiresIn: Math.floor(DEVICE_TTL_MS / 1000),
    interval: POLL_INTERVAL_SECONDS,
  };
}

export function approveSellerLinkDevice(userId: string, userCodeRaw: string): {
  userCode: string;
  expiresAt: string;
} {
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const userCode = userCodeRaw.trim().toUpperCase().replace(/\s+/g, "");
  if (!userCode) {
    throw Object.assign(new Error("user_code required"), { status: 400 });
  }
  const row = db
    .prepare(`SELECT * FROM seller_link_devices WHERE user_code=?`)
    .get(userCode) as
    | {
        device_code_hash: string;
        user_code: string;
        status: string;
        expires_at: string;
        user_id: string | null;
      }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Unknown link code"), { status: 404 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(
      `UPDATE seller_link_devices SET status='expired' WHERE device_code_hash=?`
    ).run(row.device_code_hash);
    throw Object.assign(new Error("Link code expired"), { status: 410 });
  }
  if (row.status === "denied") {
    throw Object.assign(new Error("Link code was denied"), { status: 409 });
  }
  if (row.status === "approved" || row.status === "complete") {
    if (row.user_id && row.user_id !== userId) {
      throw Object.assign(new Error("Link code already used by another account"), {
        status: 409,
      });
    }
    return { userCode: row.user_code, expiresAt: row.expires_at };
  }
  db.prepare(
    `UPDATE seller_link_devices
     SET status='approved', user_id=?, approved_at=datetime('now')
     WHERE device_code_hash=? AND status='pending'`
  ).run(userId, row.device_code_hash);
  return { userCode: row.user_code, expiresAt: row.expires_at };
}

export function denySellerLinkDevice(userId: string, userCodeRaw: string): void {
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const userCode = userCodeRaw.trim().toUpperCase().replace(/\s+/g, "");
  const row = db
    .prepare(`SELECT * FROM seller_link_devices WHERE user_code=?`)
    .get(userCode) as { device_code_hash: string; status: string; expires_at: string } | undefined;
  if (!row) {
    throw Object.assign(new Error("Unknown link code"), { status: 404 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("Link code expired"), { status: 410 });
  }
  if (row.status !== "pending" && row.status !== "approved") {
    throw Object.assign(new Error("Link code is not pending"), { status: 409 });
  }
  db.prepare(
    `UPDATE seller_link_devices SET status='denied', user_id=? WHERE device_code_hash=?`
  ).run(userId, row.device_code_hash);
}

export function pollSellerLinkDevice(deviceCodeRaw: string): SellerLinkPollResult {
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const deviceCode = deviceCodeRaw.trim();
  if (!deviceCode) {
    throw Object.assign(new Error("device_code required"), { status: 400 });
  }
  const hash = hashToken(deviceCode);
  const row = db
    .prepare(`SELECT * FROM seller_link_devices WHERE device_code_hash=?`)
    .get(hash) as
    | {
        status: string;
        expires_at: string;
        user_id: string | null;
        device_code_hash: string;
      }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Unknown device_code"), { status: 404 });
  }
  if (row.status === "denied") return { status: "denied" };
  if (row.status === "expired" || new Date(row.expires_at).getTime() < Date.now()) {
    if (row.status !== "expired") {
      db.prepare(
        `UPDATE seller_link_devices SET status='expired' WHERE device_code_hash=?`
      ).run(hash);
    }
    return { status: "expired" };
  }
  if (row.status === "pending") return { status: "pending" };
  if (row.status === "complete") {
    return { status: "expired" };
  }
  if (row.status !== "approved" || !row.user_id) {
    return { status: "pending" };
  }

  const accessToken = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  db.prepare(
    `INSERT INTO seller_link_tokens (token_hash, user_id, device_code_hash)
     VALUES (?, ?, ?)`
  ).run(hashToken(accessToken), row.user_id, hash);
  db.prepare(
    `UPDATE seller_link_devices SET status='complete' WHERE device_code_hash=?`
  ).run(hash);
  return { status: "complete", accessToken, tokenType: "Bearer" };
}

export function resolveSellerLinkBearer(
  authorizationHeader: string | undefined
): AuthenticatedUser | null {
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }
  const raw = authorizationHeader.slice(7).trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const row = db
    .prepare(
      `SELECT u.*, t.revoked_at
       FROM seller_link_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash=?`
    )
    .get(hashToken(raw)) as (CoreUser & { revoked_at: string | null }) | undefined;
  if (!row || row.revoked_at) return null;
  db.prepare(
    `UPDATE seller_link_tokens SET last_used_at=datetime('now') WHERE token_hash=?`
  ).run(hashToken(raw));
  return coreUserToAuth(row);
}

export function revokeSellerLinkBearer(authorizationHeader: string | undefined): boolean {
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Bearer ")) {
    return false;
  }
  const raw = authorizationHeader.slice(7).trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return false;
  const db = getCloudDb();
  ensureSellerLinkSchema(db);
  const result = db
    .prepare(
      `UPDATE seller_link_tokens
       SET revoked_at=datetime('now')
       WHERE token_hash=? AND revoked_at IS NULL`
    )
    .run(hashToken(raw));
  return result.changes > 0;
}

export function sellerLinkCloudUserHint(userId: string): string | null {
  const db = getCloudDb();
  const row = db.prepare(`SELECT email FROM users WHERE id=?`).get(userId) as
    | { email: string }
    | undefined;
  if (!row?.email) return null;
  const [local, domain] = row.email.split("@");
  if (!local || !domain) return row.email;
  const masked =
    local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;
  return `${masked}@${domain}`;
}

/** Local → Cloud GitHub connect for Seller accounts (#711). */
export type SellerGithubRedirectStart = {
  state: string;
  connectUrl: string;
  expiresIn: number;
};

export type SellerGithubRedirectSession = {
  state: string;
  returnUrl: string;
  status: string;
  expiresAt: string;
};

function ensureSellerGithubRedirectSchema(db: ReturnType<typeof getCloudDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seller_github_redirects (
      state_hash TEXT PRIMARY KEY,
      return_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);
}

export function startSellerGithubRedirect(returnUrlRaw: string): SellerGithubRedirectStart {
  const db = getCloudDb();
  ensureSellerGithubRedirectSchema(db);
  const returnUrl = assertSellerLinkReturnUrl(returnUrlRaw);
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + REDIRECT_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO seller_github_redirects (state_hash, return_url, status, expires_at)
     VALUES (?, ?, 'pending', ?)`
  ).run(hashToken(state), returnUrl, expiresAt);
  const publicBase = config.web.publicUrl.replace(/\/$/, "") || "https://app.godmode.software";
  return {
    state,
    connectUrl: `${publicBase}/seller-link/github?state=${encodeURIComponent(state)}`,
    expiresIn: Math.floor(REDIRECT_TTL_MS / 1000),
  };
}

function loadSellerGithubRedirect(stateRaw: string): {
  state_hash: string;
  return_url: string;
  status: string;
  expires_at: string;
} {
  const state = stateRaw.trim();
  if (!state) {
    throw Object.assign(new Error("state required"), { status: 400 });
  }
  const db = getCloudDb();
  ensureSellerGithubRedirectSchema(db);
  const row = db
    .prepare(`SELECT * FROM seller_github_redirects WHERE state_hash=?`)
    .get(hashToken(state)) as
    | {
        state_hash: string;
        return_url: string;
        status: string;
        expires_at: string;
      }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Unknown seller GitHub session"), { status: 404 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    if (row.status !== "expired" && row.status !== "complete") {
      db.prepare(
        `UPDATE seller_github_redirects SET status='expired' WHERE state_hash=?`
      ).run(row.state_hash);
    }
    throw Object.assign(new Error("Seller GitHub session expired"), { status: 410 });
  }
  return row;
}

export function getSellerGithubRedirectSession(stateRaw: string): SellerGithubRedirectSession {
  const row = loadSellerGithubRedirect(stateRaw);
  return {
    state: stateRaw.trim(),
    returnUrl: row.return_url,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

/**
 * After Seller auth + GitHub connect on Cloud, send the browser back to Local.
 */
export function completeSellerGithubRedirect(
  userId: string,
  stateRaw: string
): { redirectUrl: string } {
  const db = getCloudDb();
  ensureSellerGithubRedirectSchema(db);
  const row = loadSellerGithubRedirect(stateRaw);
  if (row.status === "complete") {
    throw Object.assign(new Error("Seller GitHub session already completed"), { status: 409 });
  }
  const github = githubProjectsStatus(getUserDb(userId), userId);
  const login = String(github.login ?? "").trim();
  if (!github.connected && !login) {
    throw Object.assign(new Error("Connect GitHub on this Seller account first"), {
      status: 400,
    });
  }
  db.prepare(
    `UPDATE seller_github_redirects
     SET status='complete', user_id=?, completed_at=datetime('now')
     WHERE state_hash=?`
  ).run(userId, row.state_hash);
  const redirect = new URL(row.return_url);
  redirect.searchParams.set("seller_github", "connected");
  if (login) redirect.searchParams.set("github_login", login);
  if (!redirect.searchParams.get("tab")) {
    redirect.searchParams.set("tab", "seller");
  }
  return { redirectUrl: redirect.toString() };
}

export type SellerStripeRedirectStart = {
  state: string;
  connectUrl: string;
  expiresIn: number;
};

export type SellerStripeRedirectSession = {
  state: string;
  returnUrl: string;
  status: string;
  expiresAt: string;
};

function ensureSellerStripeRedirectSchema(db: ReturnType<typeof getCloudDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seller_stripe_redirects (
      state_hash TEXT PRIMARY KEY,
      return_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);
}

export function startSellerStripeRedirect(returnUrlRaw: string): SellerStripeRedirectStart {
  const db = getCloudDb();
  ensureSellerStripeRedirectSchema(db);
  const returnUrl = assertSellerLinkReturnUrl(returnUrlRaw);
  const state = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + REDIRECT_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO seller_stripe_redirects (state_hash, return_url, status, expires_at)
     VALUES (?, ?, 'pending', ?)`
  ).run(hashToken(state), returnUrl, expiresAt);
  const publicBase = config.web.publicUrl.replace(/\/$/, "") || "https://app.godmode.software";
  return {
    state,
    connectUrl: `${publicBase}/seller-link/stripe?state=${encodeURIComponent(state)}`,
    expiresIn: Math.floor(REDIRECT_TTL_MS / 1000),
  };
}

function loadSellerStripeRedirect(stateRaw: string): {
  state_hash: string;
  return_url: string;
  status: string;
  expires_at: string;
} {
  const state = stateRaw.trim();
  if (!state) {
    throw Object.assign(new Error("state required"), { status: 400 });
  }
  const db = getCloudDb();
  ensureSellerStripeRedirectSchema(db);
  const row = db
    .prepare(`SELECT * FROM seller_stripe_redirects WHERE state_hash=?`)
    .get(hashToken(state)) as
    | {
        state_hash: string;
        return_url: string;
        status: string;
        expires_at: string;
      }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Unknown seller Stripe session"), { status: 404 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    if (row.status !== "expired" && row.status !== "complete") {
      db.prepare(
        `UPDATE seller_stripe_redirects SET status='expired' WHERE state_hash=?`
      ).run(row.state_hash);
    }
    throw Object.assign(new Error("Seller Stripe session expired"), { status: 410 });
  }
  return row;
}

export function getSellerStripeRedirectSession(stateRaw: string): SellerStripeRedirectSession {
  const row = loadSellerStripeRedirect(stateRaw);
  return {
    state: stateRaw.trim(),
    returnUrl: row.return_url,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

/** After Seller auth + Stripe Connect on Cloud, send the browser back to Local. */
export function completeSellerStripeRedirect(
  userId: string,
  stateRaw: string
): { redirectUrl: string } {
  const db = getCloudDb();
  ensureSellerStripeRedirectSchema(db);
  const row = loadSellerStripeRedirect(stateRaw);
  if (row.status === "complete") {
    throw Object.assign(new Error("Seller Stripe session already completed"), { status: 409 });
  }
  const payout = getSellerPayoutSnapshot(db, userId);
  const accountId = String(payout.stripeConnectAccountId ?? "").trim();
  if (!accountId.startsWith("acct_")) {
    throw Object.assign(new Error("Connect Stripe on this Seller account first"), {
      status: 400,
    });
  }
  db.prepare(
    `UPDATE seller_stripe_redirects
     SET status='complete', user_id=?, completed_at=datetime('now')
     WHERE state_hash=?`
  ).run(userId, row.state_hash);
  const redirect = new URL(row.return_url);
  redirect.searchParams.set("seller_stripe", "connected");
  if (!redirect.searchParams.get("tab")) {
    redirect.searchParams.set("tab", "seller");
  }
  return { redirectUrl: redirect.toString() };
}
