import { createHash, randomBytes } from "node:crypto";
import type { CoreDatabase, CoreUser } from "../core-db.js";
import { getCloudDb } from "../core-db.js";
import { config } from "../config.js";
import { coreUserToAuth, type AuthenticatedUser } from "../types/express-auth.js";

const DEVICE_TTL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 5;
const TOKEN_PREFIX = "gsl_";

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
  `);
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
    // One-shot: token already issued; Local should have stored it.
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
