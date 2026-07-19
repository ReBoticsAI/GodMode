import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase } from "../../core-db.js";
import { encryptSecret, decryptSecret } from "../holdings/crypto-box.js";
import { hashPassword, verifyPassword } from "./password.js";

export type AuthTokenPurpose = "verify" | "reset" | "mfa_login";

export function ensureAuthSecuritySchema(db: CoreDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx
      ON auth_tokens(user_id, purpose, expires_at);

    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      totp_secret_enc TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      recovery_codes_json TEXT NOT NULL DEFAULT '[]',
      enrolled_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_backup_meta (
      id TEXT PRIMARY KEY CHECK (id = 'latest'),
      status TEXT NOT NULL,
      local_path TEXT,
      remote_uri TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS platform_request_log (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      ip TEXT,
      user_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS platform_request_log_ts_idx
      ON platform_request_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS platform_request_log_level_idx
      ON platform_request_log(level, created_at DESC);
  `);
  // users columns added via addCol in migration companion
}

export function hashAuthToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function issueAuthToken(
  core: CoreDatabase,
  opts: { userId: string; purpose: AuthTokenPurpose; ttlMinutes: number }
): string {
  const raw = randomBytes(32).toString("hex");
  const id = uuidv4();
  const expires = new Date(Date.now() + opts.ttlMinutes * 60_000).toISOString();
  core
    .prepare(
      `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, opts.userId, opts.purpose, hashAuthToken(raw), expires);
  return raw;
}

export function consumeAuthToken(
  core: CoreDatabase,
  opts: { rawToken: string; purpose: AuthTokenPurpose }
): { userId: string } | null {
  const hash = hashAuthToken(opts.rawToken);
  const row = core
    .prepare(
      `SELECT id, user_id FROM auth_tokens
       WHERE token_hash=? AND purpose=? AND consumed_at IS NULL
         AND expires_at > datetime('now')`
    )
    .get(hash, opts.purpose) as { id: string; user_id: string } | undefined;
  if (!row) return null;
  core
    .prepare(
      `UPDATE auth_tokens SET consumed_at=datetime('now') WHERE id=? AND consumed_at IS NULL`
    )
    .run(row.id);
  return { userId: row.user_id };
}

/** Base32 encode for otpauth URIs. */
function base32Encode(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.replace(/=+$/g, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): { secretBase32: string; secretRaw: Buffer } {
  const secretRaw = randomBytes(20);
  return { secretBase32: base32Encode(secretRaw), secretRaw };
}

export function totpCode(secretBase32: string, step = 30, digits = 6): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function verifyTotp(secretBase32: string, code: string, window = 1): boolean {
  const trimmed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(trimmed)) return false;
  for (let w = -window; w <= window; w++) {
    const step = 30;
    const counter = Math.floor(Date.now() / 1000 / step) + w;
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const key = base32Decode(secretBase32);
    const hmac = createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1]! & 0xf;
    const bin =
      ((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff);
    const expected = String(bin % 1_000_000).padStart(6, "0");
    const a = Buffer.from(expected);
    const b = Buffer.from(trimmed);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function otpauthUri(opts: {
  email: string;
  secretBase32: string;
  issuer?: string;
}): string {
  const issuer = encodeURIComponent(opts.issuer ?? "GodMode");
  const label = encodeURIComponent(`${opts.issuer ?? "GodMode"}:${opts.email}`);
  return `otpauth://totp/${label}?secret=${opts.secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function getMfaRow(core: CoreDatabase, userId: string) {
  return core.prepare(`SELECT * FROM user_mfa WHERE user_id=?`).get(userId) as
    | {
        user_id: string;
        totp_secret_enc: string;
        enabled: number;
        recovery_codes_json: string;
      }
    | undefined;
}

export function beginMfaEnroll(core: CoreDatabase, userId: string, email: string) {
  const { secretBase32 } = generateTotpSecret();
  const recovery = Array.from({ length: 8 }, () => randomBytes(4).toString("hex"));
  const hashed = recovery.map((c) => hashPassword(c));
  core
    .prepare(
      `INSERT INTO user_mfa (user_id, totp_secret_enc, enabled, recovery_codes_json, enrolled_at, updated_at)
       VALUES (?, ?, 0, ?, NULL, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         totp_secret_enc=excluded.totp_secret_enc,
         enabled=0,
         recovery_codes_json=excluded.recovery_codes_json,
         enrolled_at=NULL,
         updated_at=datetime('now')`
    )
    .run(userId, encryptSecret(secretBase32), JSON.stringify(hashed));
  return {
    secretBase32,
    otpauthUrl: otpauthUri({ email, secretBase32 }),
    recoveryCodes: recovery,
  };
}

export function confirmMfaEnroll(core: CoreDatabase, userId: string, code: string): boolean {
  const row = getMfaRow(core, userId);
  if (!row) return false;
  const secret = decryptSecret(row.totp_secret_enc);
  if (!verifyTotp(secret, code)) return false;
  core
    .prepare(
      `UPDATE user_mfa SET enabled=1, enrolled_at=datetime('now'), updated_at=datetime('now')
       WHERE user_id=?`
    )
    .run(userId);
  return true;
}

export function disableMfa(core: CoreDatabase, userId: string): void {
  core.prepare(`DELETE FROM user_mfa WHERE user_id=?`).run(userId);
}

export function mfaEnabled(core: CoreDatabase, userId: string): boolean {
  const row = getMfaRow(core, userId);
  return Boolean(row?.enabled);
}

export function verifyMfaChallenge(
  core: CoreDatabase,
  userId: string,
  code: string
): boolean {
  const row = getMfaRow(core, userId);
  if (!row?.enabled) return true;
  const secret = decryptSecret(row.totp_secret_enc);
  if (verifyTotp(secret, code)) return true;
  const codes = JSON.parse(row.recovery_codes_json || "[]") as string[];
  for (let i = 0; i < codes.length; i++) {
    if (verifyPassword(code.trim(), codes[i]!)) {
      codes.splice(i, 1);
      core
        .prepare(
          `UPDATE user_mfa SET recovery_codes_json=?, updated_at=datetime('now') WHERE user_id=?`
        )
        .run(JSON.stringify(codes), userId);
      return true;
    }
  }
  return false;
}

export function markEmailVerified(core: CoreDatabase, userId: string): void {
  core
    .prepare(
      `UPDATE users SET email_verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    )
    .run(userId);
}

export function setPasswordHash(
  core: CoreDatabase,
  userId: string,
  passwordHash: string
): void {
  core
    .prepare(
      `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(passwordHash, userId);
}

export function upsertOauthAccount(
  core: CoreDatabase,
  opts: {
    provider: string;
    providerUserId: string;
    userId: string;
    profileJson: string;
  }
): void {
  core
    .prepare(
      `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, profile_json, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(provider, provider_user_id) DO UPDATE SET
         user_id=excluded.user_id, updated_at=datetime('now')`
    )
    .run(opts.provider, opts.providerUserId, opts.userId, opts.profileJson);
}

export function markEmailVerifiedIfNull(
  core: CoreDatabase,
  userId: string
): void {
  core
    .prepare(
      `UPDATE users SET email_verified_at=COALESCE(email_verified_at, datetime('now')),
         updated_at=datetime('now') WHERE id=?`
    )
    .run(userId);
}
