import { createHash, randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase, CoreUser } from "../../core-db.js";

const SESSION_COOKIE = "godmode_session";
const LEGACY_SESSION_COOKIE = "money_session";

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export function createSession(
  core: CoreDatabase,
  userId: string,
  ttlDays: number
): string {
  const id = randomBytes(32).toString("hex");
  const expires = new Date();
  expires.setDate(expires.getDate() + ttlDays);
  core.prepare(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
  ).run(id, userId, expires.toISOString());
  purgeExpiredSessions(core);
  return id;
}

export function deleteSession(core: CoreDatabase, sessionId: string): void {
  core.prepare(`DELETE FROM sessions WHERE id=?`).run(sessionId);
}

export function resolveSession(
  core: CoreDatabase,
  sessionId: string | undefined
): { user: CoreUser; sessionId: string } | null {
  if (!sessionId) return null;
  purgeExpiredSessions(core);
  const row = core
    .prepare(
      `SELECT s.id AS session_id, u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id=? AND s.expires_at > datetime('now')`
    )
    .get(sessionId) as (CoreUser & { session_id: string }) | undefined;
  if (!row) return null;
  return { user: row, sessionId: row.session_id };
}

export function parseSessionCookie(
  cookieHeader: string | undefined
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE || k === LEGACY_SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

export function buildSessionCookie(
  sessionId: string,
  maxAgeDays: number,
  secure: boolean
): string {
  const maxAge = maxAgeDays * 24 * 60 * 60;
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearLegacySessionCookie(secure: boolean): string {
  const parts = [
    `${LEGACY_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function issueSessionCookies(sessionId: string, maxAgeDays: number, secure: boolean): string[] {
  return [
    buildSessionCookie(sessionId, maxAgeDays, secure),
    clearLegacySessionCookie(secure),
  ];
}

function purgeExpiredSessions(core: CoreDatabase): void {
  core.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
}

export function slugFromEmail(email: string): string {
  const base = email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 6);
  return `${base || "user"}-${hash}`;
}

export function upsertOAuthUser(
  core: CoreDatabase,
  opts: {
    provider: string;
    providerUserId: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
    accessToken?: string;
    refreshToken?: string;
  }
): CoreUser {
  const existingOAuth = core
    .prepare(
      `SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_user_id=?`
    )
    .get(opts.provider, opts.providerUserId) as { user_id: string } | undefined;

  if (existingOAuth) {
    core.prepare(
      `UPDATE oauth_accounts SET access_token=?, refresh_token=?, profile_json=?, updated_at=datetime('now')
       WHERE provider=? AND provider_user_id=?`
    ).run(
      opts.accessToken ?? null,
      opts.refreshToken ?? null,
      JSON.stringify({ displayName: opts.displayName, avatarUrl: opts.avatarUrl }),
      opts.provider,
      opts.providerUserId
    );
    return core
      .prepare("SELECT * FROM users WHERE id=?")
      .get(existingOAuth.user_id) as CoreUser;
  }

  let user = core
    .prepare("SELECT * FROM users WHERE email=?")
    .get(opts.email) as CoreUser | undefined;

  if (!user) {
    const id = uuidv4();
    core.prepare(
      `INSERT INTO users (id, email, display_name, avatar_url, is_admin)
       VALUES (?, ?, ?, ?, 0)`
    ).run(id, opts.email, opts.displayName, opts.avatarUrl ?? null);
    core.prepare(
      `INSERT OR IGNORE INTO credit_wallets (user_id, balance) VALUES (?, 100)`
    ).run(id);
    user = core.prepare("SELECT * FROM users WHERE id=?").get(id) as CoreUser;
  } else {
    core.prepare(
      `UPDATE users SET display_name=?, avatar_url=COALESCE(?, avatar_url),
       updated_at=datetime('now') WHERE id=?`
    ).run(opts.displayName, opts.avatarUrl ?? null, user.id);
    user = core.prepare("SELECT * FROM users WHERE id=?").get(user.id) as CoreUser;
  }

  core.prepare(
    `INSERT INTO oauth_accounts
       (provider, provider_user_id, user_id, access_token, refresh_token, profile_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    opts.provider,
    opts.providerUserId,
    user.id,
    opts.accessToken ?? null,
    opts.refreshToken ?? null,
    JSON.stringify({ displayName: opts.displayName, avatarUrl: opts.avatarUrl })
  );

  return user;
}
