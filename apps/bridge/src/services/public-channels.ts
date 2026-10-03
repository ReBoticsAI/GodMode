/**
 * Cloud lobby (#general, …) vs this-install lobby (#local).
 * Public kind on dm_conversations; visitors may read; send needs entitlement.
 */

import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase, CoreDmConversation } from "../core-db.js";
import { getCloudDb, getOperatorTenantId } from "../core-db.js";
import { config } from "../config.js";
import {
  findActiveGodModeInferenceGrant,
  isGrantSpendable,
  type GodModeInferenceGrantRow,
} from "./godmode-inference-grants.js";
import {
  getSellerEntitlementForUser,
  subscriptionGrantsAccess,
  type SaasSubscription,
} from "./saas-subscriptions.js";
import { cloudCommerceBase } from "./marketplace-cloud-checkout-client.js";

/** Shared GodMode Cloud lobby channels (SaaS Users hub SoR). */
export const CLOUD_LOBBY_SLUGS = [
  "general",
  "dev",
  "roadmap",
  "support",
  "thegame",
] as const;

/** @deprecated Prefer CLOUD_LOBBY_SLUGS. */
export const PUBLIC_CHANNEL_SLUGS = CLOUD_LOBBY_SLUGS;

export type CloudLobbySlug = (typeof CLOUD_LOBBY_SLUGS)[number];
export type PublicChannelSlug = CloudLobbySlug;

/** Per-install public room (Local / Desktop / PWA / SaaS node). */
export const INSTALL_LOCAL_SLUG = "local" as const;

export const PUBLIC_CHANNEL_SYSTEM_USER = "system-local";

const SCHEMA_META_KEY = "dm_public_channels_v3";
const ROLES_META_KEY = "dm_public_channel_roles_v1";
const AGENTS_BIND_META_KEY = "dm_public_channel_agents_v1";

export type PublicChannelPlane = "install" | "cloud";

export type PublicChannelRole =
  | "admin"
  | "moderator"
  | "member"
  | "visitor";

export type PublicChannelView = {
  id: string;
  slug: string;
  title: string;
  plane: PublicChannelPlane;
  kind: "public";
  /** Operator-tenant channel agent id (`channel-{slug}`). */
  agentId: string;
  /** Caller's effective role when directory is loaded authenticated. */
  viewerRole?: PublicChannelRole;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  displayTitle: string;
  unreadCount: number;
};

export function channelAgentIdForSlug(slug: string): string {
  return `channel-${slug.trim()}`;
}

export function isChannelAgentId(agentId: string | null | undefined): boolean {
  return Boolean(agentId?.startsWith("channel-"));
}

export function slugFromChannelAgentId(
  agentId: string | null | undefined
): string | null {
  if (!agentId?.startsWith("channel-")) return null;
  const slug = agentId.slice("channel-".length).trim();
  return slug || null;
}

/** Slugs that get a channel agent on this install. */
export function channelAgentSlugsForInstall(): string[] {
  const slugs = [INSTALL_LOCAL_SLUG];
  if (config.isSaas) {
    for (const slug of CLOUD_LOBBY_SLUGS) {
      if (!slugs.includes(slug)) slugs.push(slug);
    }
  }
  return slugs;
}

export type PublicChatEntitlement = {
  ok: boolean;
  reason: string;
  /** Cloud workspace seat */
  cloudSeat: boolean;
  seller: boolean;
  /** Paid Inference pack/subscription (not free trial) */
  paidInference: boolean;
};

function titleForSlug(slug: string): string {
  return `#${slug}`;
}

export function isCloudLobbySlug(slug: string | null | undefined): boolean {
  return Boolean(
    slug && (CLOUD_LOBBY_SLUGS as readonly string[]).includes(slug)
  );
}

function hubMetaGet(db: CoreDatabase, key: string): string | null {
  try {
    const row = db
      .prepare(`SELECT value FROM host_users_meta WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function hubMetaSet(db: CoreDatabase, key: string, value: string): void {
  db.prepare(
    `INSERT INTO host_users_meta (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`
  ).run(key, value);
}

function columnNames(db: CoreDatabase, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
  ).map((c) => c.name);
}

function seedPublicSlug(db: CoreDatabase, slug: string): void {
  const existing = db
    .prepare(
      `SELECT id FROM dm_conversations WHERE kind = 'public' AND slug = ?`
    )
    .get(slug) as { id: string } | undefined;
  if (existing) return;
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dm_conversations
       (id, kind, title, slug, created_by_user_id, created_at, updated_at)
     VALUES (?, 'public', ?, ?, ?, ?, ?)`
  ).run(id, titleForSlug(slug), slug, PUBLIC_CHANNEL_SYSTEM_USER, now, now);
}

/** Ensure dm_conversations.slug exists (CREATE IF NOT EXISTS never adds columns). */
function ensureDmConversationSlugColumn(db: CoreDatabase): void {
  const cols = columnNames(db, "dm_conversations");
  if (cols.length === 0) return;
  if (!cols.includes("slug")) {
    db.exec(`ALTER TABLE dm_conversations ADD COLUMN slug TEXT`);
  }
}

/** Rebuild dm_conversations CHECK to allow kind=public and add slug. */
export function ensurePublicChannelSchema(db: CoreDatabase): void {
  ensureDmConversationSlugColumn(db);

  if (hubMetaGet(db, SCHEMA_META_KEY) === "1") {
    seedPublicChannelCatalog(db);
    ensurePublicChannelMemberRoles(db);
    bindChannelAgentsToPublicConversations(db);
    return;
  }

  let needsRebuild = true;
  try {
    const probeId = `__probe_public_${uuidv4()}`;
    db.prepare(
      `INSERT INTO dm_conversations
         (id, kind, title, slug, created_by_user_id, created_at, updated_at)
       VALUES (?, 'public', '#probe', 'probe', ?, datetime('now'), datetime('now'))`
    ).run(probeId, PUBLIC_CHANNEL_SYSTEM_USER);
    db.prepare(`DELETE FROM dm_conversations WHERE id = ?`).run(probeId);
    needsRebuild = false;
  } catch {
    needsRebuild = true;
  }

  if (needsRebuild) {
    // Re-ensure slug before SELECT … slug in the rebuild (older hubs).
    ensureDmConversationSlugColumn(db);
    db.exec(`PRAGMA foreign_keys = OFF`);
    try {
      db.exec(`
        CREATE TABLE dm_conversations_public_mig (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('direct', 'group', 'public')),
          title TEXT,
          slug TEXT,
          created_by_user_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_message_at TEXT,
          last_message_preview TEXT
        );
        INSERT INTO dm_conversations_public_mig
          (id, kind, title, slug, created_by_user_id, created_at, updated_at,
           last_message_at, last_message_preview)
        SELECT id, kind, title, slug, created_by_user_id, created_at, updated_at,
               last_message_at, last_message_preview
        FROM dm_conversations;
        DROP TABLE dm_conversations;
        ALTER TABLE dm_conversations_public_mig RENAME TO dm_conversations;
        CREATE INDEX IF NOT EXISTS dm_conversations_updated_idx
          ON dm_conversations(last_message_at DESC, updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS dm_conversations_public_slug_idx
          ON dm_conversations(slug) WHERE kind = 'public' AND slug IS NOT NULL;
      `);
    } finally {
      db.exec(`PRAGMA foreign_keys = ON`);
    }
  } else {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS dm_conversations_public_slug_idx
        ON dm_conversations(slug) WHERE kind = 'public' AND slug IS NOT NULL;
    `);
  }

  seedPublicChannelCatalog(db);
  ensurePublicChannelMemberRoles(db);
  bindChannelAgentsToPublicConversations(db);
  hubMetaSet(db, SCHEMA_META_KEY, "1");
}

/** Widen membership roles for public/private conversations. */
export function ensurePublicChannelMemberRoles(db: CoreDatabase): void {
  if (hubMetaGet(db, ROLES_META_KEY) === "1") {
    promotePlatformAdminsOnPublicChannels(db);
    return;
  }

  const memberCols = new Set(columnNames(db, "dm_conversation_members"));
  if (memberCols.size === 0) {
    // Fresh hub: migrateHostUsersDb CREATE IF NOT EXISTS should have made this.
    promotePlatformAdminsOnPublicChannels(db);
    hubMetaSet(db, ROLES_META_KEY, "1");
    return;
  }

  const pick = (name: string, fallbackSql: string): string =>
    memberCols.has(name) ? name : fallbackSql;

  db.exec(`PRAGMA foreign_keys = OFF`);
  try {
    // Drop leftovers from a prior interrupted migration.
    db.exec(`DROP TABLE IF EXISTS dm_conversation_members_roles_mig`);
    db.exec(`
      CREATE TABLE dm_conversation_members_roles_mig (
        conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member'
          CHECK (role IN ('owner', 'admin', 'moderator', 'member', 'visitor')),
        joined_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_read_at TEXT,
        last_read_message_id TEXT,
        member_kind TEXT NOT NULL DEFAULT 'user',
        agent_id TEXT,
        agent_tenant_id TEXT,
        PRIMARY KEY (conversation_id, user_id)
      );
      INSERT INTO dm_conversation_members_roles_mig
        (conversation_id, user_id, role, joined_at, last_read_at,
         last_read_message_id, member_kind, agent_id, agent_tenant_id)
      SELECT conversation_id, user_id, role,
             ${pick("joined_at", "datetime('now')")},
             ${pick("last_read_at", "NULL")},
             ${pick("last_read_message_id", "NULL")},
             ${pick("member_kind", "'user'")},
             ${pick("agent_id", "NULL")},
             ${pick("agent_tenant_id", "NULL")}
      FROM dm_conversation_members;
      DROP TABLE dm_conversation_members;
      ALTER TABLE dm_conversation_members_roles_mig RENAME TO dm_conversation_members;
      CREATE INDEX IF NOT EXISTS dm_conversation_members_user_idx
        ON dm_conversation_members(user_id, conversation_id);
    `);
  } finally {
    db.exec(`PRAGMA foreign_keys = ON`);
  }

  promotePlatformAdminsOnPublicChannels(db);
  hubMetaSet(db, ROLES_META_KEY, "1");
}

function promotePlatformAdminsOnPublicChannels(db: CoreDatabase): void {
  let adminIds: string[] = [];
  try {
    adminIds = (
      getCloudDb()
        .prepare(
          `SELECT id FROM users WHERE is_admin = 1 AND id <> ?`
        )
        .all(PUBLIC_CHANNEL_SYSTEM_USER) as Array<{ id: string }>
    ).map((r) => r.id);
  } catch {
    adminIds = [];
  }
  if (adminIds.length === 0) return;

  const channels = db
    .prepare(`SELECT id FROM dm_conversations WHERE kind = 'public'`)
    .all() as Array<{ id: string }>;
  const upsert = db.prepare(
    `INSERT INTO dm_conversation_members
       (conversation_id, user_id, role, member_kind)
     VALUES (?, ?, 'admin', 'user')
     ON CONFLICT(conversation_id, user_id) DO UPDATE SET
       role = CASE
         WHEN dm_conversation_members.role IN ('admin', 'moderator')
           THEN dm_conversation_members.role
         ELSE 'admin'
       END`
  );
  for (const ch of channels) {
    for (const userId of adminIds) {
      upsert.run(ch.id, userId);
    }
  }
}

/** Attach channel-{slug} agent members to public conversations (idempotent). */
export function bindChannelAgentsToPublicConversations(db: CoreDatabase): void {
  let operatorTenantId: string | null = null;
  try {
    operatorTenantId = getOperatorTenantId(getCloudDb());
  } catch {
    operatorTenantId = null;
  }
  if (!operatorTenantId) return;

  const rows = db
    .prepare(
      `SELECT id, slug FROM dm_conversations WHERE kind = 'public' AND slug IS NOT NULL`
    )
    .all() as Array<{ id: string; slug: string }>;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO dm_conversation_members
       (conversation_id, user_id, role, member_kind, agent_id, agent_tenant_id)
     VALUES (?, ?, 'member', 'agent', ?, ?)`
  );
  for (const row of rows) {
    const agentId = channelAgentIdForSlug(row.slug);
    insert.run(row.id, `agent:${agentId}`, agentId, operatorTenantId);
  }
  hubMetaSet(db, AGENTS_BIND_META_KEY, "1");
}

/** Seed #local everywhere; seed Cloud lobby slugs only on SaaS. */
export function seedPublicChannelCatalog(db: CoreDatabase): void {
  seedPublicSlug(db, INSTALL_LOCAL_SLUG);
  if (config.isSaas) {
    for (const slug of CLOUD_LOBBY_SLUGS) {
      seedPublicSlug(db, slug);
    }
  }
}

/** @deprecated Use seedPublicChannelCatalog. */
export function seedInstallPublicChannels(db: CoreDatabase): void {
  seedPublicChannelCatalog(db);
}

function rowToPublicView(
  row: CoreDmConversation & { slug?: string | null },
  plane: PublicChannelPlane
): PublicChannelView {
  const slug = row.slug?.trim() || "channel";
  const title = row.title?.trim() || titleForSlug(slug);
  return {
    id: row.id,
    slug,
    title,
    plane,
    kind: "public",
    agentId: channelAgentIdForSlug(slug),
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    displayTitle: title.startsWith("#") ? title : `#${title.replace(/^#/, "")}`,
    unreadCount: 0,
  };
}

/** This install: only #local. */
export function listInstallPublicChannels(db: CoreDatabase): PublicChannelView[] {
  seedPublicChannelCatalog(db);
  const rows = db
    .prepare(
      `SELECT * FROM dm_conversations
       WHERE kind = 'public' AND slug = ?
       ORDER BY created_at ASC`
    )
    .all(INSTALL_LOCAL_SLUG) as Array<
    CoreDmConversation & { slug?: string | null }
  >;
  return rows.map((r) => rowToPublicView(r, "install"));
}

/** Cloud lobby rows from this hub (SaaS SoR). Empty on Local. */
export function listCloudLobbyChannels(db: CoreDatabase): PublicChannelView[] {
  if (!config.isSaas) return [];
  seedPublicChannelCatalog(db);
  const rows = db
    .prepare(
      `SELECT * FROM dm_conversations
       WHERE kind = 'public'
         AND slug IN (${CLOUD_LOBBY_SLUGS.map(() => "?").join(", ")})
       ORDER BY CASE slug
         WHEN 'general' THEN 0
         WHEN 'dev' THEN 1
         WHEN 'roadmap' THEN 2
         WHEN 'support' THEN 3
         WHEN 'thegame' THEN 4
         ELSE 50
       END`
    )
    .all(...CLOUD_LOBBY_SLUGS) as Array<
    CoreDmConversation & { slug?: string | null }
  >;
  return rows.map((r) => rowToPublicView(r, "cloud"));
}

export function getPublicChannelById(
  db: CoreDatabase,
  conversationId: string
): (CoreDmConversation & { slug?: string | null }) | null {
  const row = db
    .prepare(`SELECT * FROM dm_conversations WHERE id = ? AND kind = 'public'`)
    .get(conversationId) as
    | (CoreDmConversation & { slug?: string | null })
    | undefined;
  return row ?? null;
}

export function isPublicConversation(
  db: CoreDatabase,
  conversationId: string
): boolean {
  return Boolean(getPublicChannelById(db, conversationId));
}

function hasPaidInference(userId: string): boolean {
  const grant = findActiveGodModeInferenceGrant({ userId }) as
    | GodModeInferenceGrantRow
    | null;
  if (!grant || !isGrantSpendable(grant)) return false;
  return grant.kind === "pack" || grant.kind === "subscription";
}

function hasCloudWorkspaceSeat(userId: string): boolean {
  try {
    const rows = getCloudDb()
      .prepare(
        `SELECT * FROM saas_subscriptions
         WHERE user_id=?
         ORDER BY datetime(updated_at) DESC`
      )
      .all(userId) as SaasSubscription[];
    return rows.some((row) => subscriptionGrantsAccess(row));
  } catch {
    return false;
  }
}

/** Public lobby send: Cloud seat, Seller, or paid Inference (not free trial). */
export function getPublicChatEntitlement(userId: string): PublicChatEntitlement {
  const cloudSeat = hasCloudWorkspaceSeat(userId);
  let seller = false;
  try {
    seller = getSellerEntitlementForUser(userId).sellerActive;
  } catch {
    seller = false;
  }
  const paidInference = hasPaidInference(userId);
  const ok = cloudSeat || seller || paidInference;
  return {
    ok,
    cloudSeat,
    seller,
    paidInference,
    reason: ok
      ? "ok"
      : "Public chat needs a GodMode Cloud seat, Seller account, or paid GodMode Inference pack.",
  };
}

export function canSendPublicChat(userId: string): boolean {
  return getPublicChatEntitlement(userId).ok;
}

/** On SaaS, this hub is the Cloud lobby SoR. */
export function cloudLobbyIsLocal(): boolean {
  return config.isSaas;
}

export async function fetchRemoteCloudLobbyChannels(): Promise<
  PublicChannelView[]
> {
  if (cloudLobbyIsLocal()) {
    return [];
  }
  const base = cloudCommerceBase();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/api/dm/public-lobby`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      channels?: PublicChannelView[];
    };
    return (json.channels ?? [])
      .filter((c) => isCloudLobbySlug(c.slug))
      .map((c) => ({
        ...c,
        plane: "cloud" as const,
        kind: "public" as const,
        agentId: c.agentId || channelAgentIdForSlug(c.slug),
      }));
  } catch {
    return [];
  }
}

export async function fetchRemoteCloudLobbyMessages(
  slug: string,
  opts?: { before?: string; limit?: number }
): Promise<unknown[]> {
  if (cloudLobbyIsLocal()) return [];
  if (!isCloudLobbySlug(slug)) return [];
  const base = cloudCommerceBase();
  if (!base) return [];
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  try {
    const res = await fetch(
      `${base}/api/dm/public-lobby/${encodeURIComponent(slug)}/messages${
        qs ? `?${qs}` : ""
      }`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { messages?: unknown[] };
    return json.messages ?? [];
  } catch {
    return [];
  }
}
