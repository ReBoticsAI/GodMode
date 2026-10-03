/**
 * Cloud-wide @username registry (humans + public ecosystem agents).
 * SoR: Cloud.sqlite public_handles (+ users.username denormalized for users).
 */

import type { CoreDatabase } from "../core-db.js";
import { getCloudDb } from "../core-db.js";

/** Keep in sync with public-channels lobby slugs (avoid import cycle / mock breakage). */
const CLOUD_LOBBY_HANDLE_SLUGS = [
  "general",
  "dev",
  "roadmap",
  "support",
  "thegame",
] as const;
const INSTALL_LOCAL_HANDLE = "local";

function channelAgentIdForSlug(slug: string): string {
  return `channel-${slug.trim()}`;
}

export type PublicHandleSubjectKind = "user" | "agent";

export type PublicHandleRow = {
  handle: string;
  subject_kind: PublicHandleSubjectKind;
  subject_id: string;
  agent_tenant_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ResolvedPublicHandle =
  | {
      kind: "user";
      handle: string;
      userId: string;
      displayName: string;
      avatarUrl: string | null;
    }
  | {
      kind: "agent";
      handle: string;
      agentId: string;
      agentTenantId: string | null;
    };

export class PublicHandleError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PublicHandleError";
    this.status = status;
  }
}

const HANDLE_RE = /^[a-z0-9_]{3,32}$/;

/** Static reserved names (users cannot claim). Agent seeds may own some of these. */
const RESERVED_USER_HANDLES = new Set([
  "admin",
  "administrator",
  "support",
  "godmode",
  "system",
  "root",
  "api",
  "help",
  "mod",
  "moderator",
  "official",
  "staff",
  "null",
  "undefined",
  "you",
  "me",
  "here",
  "everyone",
  "channel",
  "marketplace",
  "guest",
  "visitor",
]);

const AGENT_SEED_HANDLES = [
  "intelligence",
  INSTALL_LOCAL_HANDLE,
  ...CLOUD_LOBBY_HANDLE_SLUGS,
] as const;

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function isValidHandleFormat(handle: string): boolean {
  return HANDLE_RE.test(handle);
}

export function isReservedForUserClaim(handle: string): boolean {
  if (RESERVED_USER_HANDLES.has(handle)) return true;
  if (handle.startsWith("channel_") || handle.startsWith("channel-")) return true;
  if ((AGENT_SEED_HANDLES as readonly string[]).includes(handle)) return true;
  return false;
}

export function ensurePublicHandlesSchema(db: CoreDatabase = getCloudDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS public_handles (
      handle TEXT PRIMARY KEY,
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'agent')),
      subject_id TEXT NOT NULL,
      agent_tenant_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS public_handles_subject_uidx
      ON public_handles(subject_kind, subject_id);
  `);
}

export function getHandleForSubject(
  kind: PublicHandleSubjectKind,
  subjectId: string,
  db: CoreDatabase = getCloudDb()
): string | null {
  const row = db
    .prepare(
      `SELECT handle FROM public_handles WHERE subject_kind=? AND subject_id=?`
    )
    .get(kind, subjectId) as { handle: string } | undefined;
  return row?.handle ?? null;
}

export function resolveHandle(
  raw: string,
  db: CoreDatabase = getCloudDb()
): ResolvedPublicHandle | null {
  const handle = normalizeHandle(raw);
  if (!handle || !isValidHandleFormat(handle)) return null;
  const row = db
    .prepare(`SELECT * FROM public_handles WHERE handle=?`)
    .get(handle) as PublicHandleRow | undefined;
  if (!row) return null;
  if (row.subject_kind === "user") {
    const user = db
      .prepare(
        `SELECT id, display_name, avatar_url FROM users WHERE id=? AND id<>'system-local'`
      )
      .get(row.subject_id) as
      | { id: string; display_name: string; avatar_url: string | null }
      | undefined;
    if (!user) return null;
    return {
      kind: "user",
      handle: row.handle,
      userId: user.id,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    };
  }
  return {
    kind: "agent",
    handle: row.handle,
    agentId: row.subject_id,
    agentTenantId: row.agent_tenant_id,
  };
}

export function searchHandles(
  query: string,
  limit = 20,
  db: CoreDatabase = getCloudDb()
): Array<{ handle: string; kind: PublicHandleSubjectKind; subjectId: string }> {
  const q = normalizeHandle(query);
  if (!q) return [];
  const lim = Math.min(Math.max(limit, 1), 50);
  return db
    .prepare(
      `SELECT handle, subject_kind AS kind, subject_id AS subjectId
       FROM public_handles
       WHERE handle LIKE ? || '%'
       ORDER BY handle ASC
       LIMIT ?`
    )
    .all(q, lim) as Array<{
    handle: string;
    kind: PublicHandleSubjectKind;
    subjectId: string;
  }>;
}

export function assertHandleAvailable(
  raw: string,
  opts: { forUserId?: string } = {},
  db: CoreDatabase = getCloudDb()
): string {
  const handle = normalizeHandle(raw);
  if (!isValidHandleFormat(handle)) {
    throw new PublicHandleError(
      400,
      "Username must be 3 to 32 characters: lowercase letters, numbers, underscore"
    );
  }
  if (isReservedForUserClaim(handle)) {
    throw new PublicHandleError(400, "That username is reserved");
  }
  const existing = db
    .prepare(`SELECT subject_kind, subject_id FROM public_handles WHERE handle=?`)
    .get(handle) as
    | { subject_kind: PublicHandleSubjectKind; subject_id: string }
    | undefined;
  if (
    existing &&
    !(
      opts.forUserId &&
      existing.subject_kind === "user" &&
      existing.subject_id === opts.forUserId
    )
  ) {
    throw new PublicHandleError(409, "That username is already taken");
  }
  return handle;
}

export function claimUserHandle(
  userId: string,
  raw: string,
  db: CoreDatabase = getCloudDb()
): string {
  if (!userId || userId === "system-local") {
    throw new PublicHandleError(400, "Invalid user");
  }
  const handle = assertHandleAvailable(raw, { forUserId: userId }, db);
  db.transaction(() => {
    const prev = db
      .prepare(
        `SELECT handle FROM public_handles WHERE subject_kind='user' AND subject_id=?`
      )
      .get(userId) as { handle: string } | undefined;
    if (prev?.handle && prev.handle !== handle) {
      db.prepare(`DELETE FROM public_handles WHERE handle=?`).run(prev.handle);
    }
    db.prepare(
      `INSERT INTO public_handles (handle, subject_kind, subject_id, agent_tenant_id, updated_at)
       VALUES (?, 'user', ?, NULL, datetime('now'))
       ON CONFLICT(handle) DO UPDATE SET
         subject_kind=excluded.subject_kind,
         subject_id=excluded.subject_id,
         agent_tenant_id=NULL,
         updated_at=datetime('now')`
    ).run(handle, userId);
    db.prepare(
      `UPDATE users SET username=?, updated_at=datetime('now') WHERE id=?`
    ).run(handle, userId);
  })();
  return handle;
}

export function releaseUserHandle(
  userId: string,
  db: CoreDatabase = getCloudDb()
): void {
  db.transaction(() => {
    db.prepare(
      `DELETE FROM public_handles WHERE subject_kind='user' AND subject_id=?`
    ).run(userId);
    db.prepare(
      `UPDATE users SET username=NULL, updated_at=datetime('now') WHERE id=?`
    ).run(userId);
  })();
}

/** Seed channel + Intelligence handles (idempotent). */
export function ensurePublicAgentHandles(
  operatorTenantId: string,
  db: CoreDatabase = getCloudDb()
): void {
  if (!operatorTenantId.trim()) return;
  ensurePublicHandlesSchema(db);
  const upsert = db.prepare(
    `INSERT INTO public_handles (handle, subject_kind, subject_id, agent_tenant_id, updated_at)
     VALUES (?, 'agent', ?, ?, datetime('now'))
     ON CONFLICT(handle) DO UPDATE SET
       subject_kind='agent',
       subject_id=excluded.subject_id,
       agent_tenant_id=excluded.agent_tenant_id,
       updated_at=datetime('now')
     WHERE public_handles.subject_kind='agent'`
  );
  upsert.run("intelligence", "intelligence", operatorTenantId);
  for (const slug of [INSTALL_LOCAL_HANDLE, ...CLOUD_LOBBY_HANDLE_SLUGS]) {
    upsert.run(slug, channelAgentIdForSlug(slug), operatorTenantId);
  }
}

const MENTION_RE = /@([a-z0-9_]{3,32})\b/gi;

export function extractMentionHandles(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const h = normalizeHandle(match[1] ?? "");
    if (isValidHandleFormat(h)) found.add(h);
  }
  return [...found];
}

export function resolveMentionsInText(
  text: string,
  db: CoreDatabase = getCloudDb()
): Array<{
  handle: string;
  subjectKind: PublicHandleSubjectKind;
  subjectId: string;
  agentTenantId?: string | null;
}> {
  const out: Array<{
    handle: string;
    subjectKind: PublicHandleSubjectKind;
    subjectId: string;
    agentTenantId?: string | null;
  }> = [];
  for (const handle of extractMentionHandles(text)) {
    const resolved = resolveHandle(handle, db);
    if (!resolved) continue;
    if (resolved.kind === "user") {
      out.push({
        handle: resolved.handle,
        subjectKind: "user",
        subjectId: resolved.userId,
      });
    } else {
      out.push({
        handle: resolved.handle,
        subjectKind: "agent",
        subjectId: resolved.agentId,
        agentTenantId: resolved.agentTenantId,
      });
    }
  }
  return out;
}
