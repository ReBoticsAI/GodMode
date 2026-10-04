import { v4 as uuidv4 } from "uuid";
import {
  getCloudDb,
  getOperatorTenantId,
  type CoreDatabase,
  type CoreDmConversation,
  type CoreDmMessage,
  type CoreDmMessageAttachment,
  type DmAttachmentKind,
  type DmConversationKind,
  type DmMemberKind,
  type DmMemberRole,
  type DmSenderKind,
  type MarketplaceListingKind,
  type ShareGrantRole,
} from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { getAgent } from "./agents/agents-db.js";
import { createShareGrant } from "./share-service.js";
import { isUserOnline } from "./presence.js";
import { blobHref } from "./blob-store.js";
import {
  canSendToPublicConversation,
  publicSendDeniedMessage,
  getPublicChannelById,
  isChannelAgentId,
  isCloudLobbySlug,
  isPublicConversation,
  listInstallPublicChannels,
  slugFromChannelAgentId,
  type PublicChannelRole,
} from "./public-channels.js";
import {
  getHandleForSubject,
  resolveMentionsInText,
} from "./public-handles.js";
import { createNotification } from "./notification-service.js";

export class DmError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "DmError";
  }
}

export interface DmUserSummary {
  id: string;
  email: string;
  displayName: string;
  /** Cloud-wide @username when claimed. */
  username: string | null;
  avatarUrl: string | null;
  online: boolean;
}

export interface DmContact extends DmUserSummary {
  relationship: "share" | "tenant" | "lookup";
}

export interface DmAttachmentInput {
  kind: DmAttachmentKind;
  blobId?: string;
  resourceKind?: string;
  resourceId?: string;
  label?: string;
  href?: string;
  mime?: string;
  size?: number;
}

export interface DmAttachmentView {
  id: string;
  kind: DmAttachmentKind;
  blobId: string | null;
  href: string | null;
  resourceKind: string | null;
  resourceId: string | null;
  label: string | null;
  mime: string | null;
  size: number | null;
}

export interface DmAgentSummary {
  id: string;
  tenantId: string;
  name: string;
  icon: string | null;
  /** Cloud-wide @username when seeded/claimed. */
  username: string | null;
}

export type DmMentionView = {
  handle: string;
  subjectKind: "user" | "agent";
  subjectId: string;
  agentTenantId?: string | null;
};

export interface DmMessageView {
  id: string;
  conversationId: string;
  senderKind: DmSenderKind;
  senderUserId: string | null;
  sender: DmUserSummary | null;
  senderAgentId: string | null;
  senderAgent: DmAgentSummary | null;
  bodyText: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments: DmAttachmentView[];
  mentions?: DmMentionView[];
}

export interface DmConversationMemberView {
  memberKind: DmMemberKind;
  userId: string | null;
  role: DmMemberRole;
  joinedAt: string;
  lastReadAt: string | null;
  user: DmUserSummary | null;
  agentId: string | null;
  agentTenantId: string | null;
  agent: DmAgentSummary | null;
}

export interface DmConversationView {
  id: string;
  kind: DmConversationKind;
  title: string | null;
  /** Public lobby slug when kind is public. */
  slug?: string | null;
  /** install = this Users hub; cloud = GodMode Cloud lobby (client tags). */
  plane?: "install" | "cloud";
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  members: DmConversationMemberView[];
  displayTitle: string;
}

/** Synthetic user_id for agent rows in dm_conversation_members (PK uniqueness). */
export function agentMemberUserId(agentId: string): string {
  return `agent:${agentId}`;
}

function agentSummary(
  agentTenantId: string,
  agentId: string
): DmAgentSummary | null {
  try {
    const agent = getAgent(getTenantDb(agentTenantId), agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      tenantId: agentTenantId,
      name: agent.name,
      icon: agent.icon,
      username: getHandleForSubject("agent", agentId),
    };
  } catch {
    return null;
  }
}

function userSummary(
  _hubDb: CoreDatabase,
  userId: string,
  opts?: { redactEmail?: boolean }
): DmUserSummary | null {
  const row = getCloudDb()
    .prepare(
      `SELECT id, email, display_name, username, avatar_url FROM users WHERE id = ?`
    )
    .get(userId) as
    | {
        id: string;
        email: string;
        display_name: string;
        username: string | null;
        avatar_url: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    // Public lobby is world-readable; never ship emails there.
    email: opts?.redactEmail ? "" : row.email,
    displayName: row.display_name,
    username: row.username ?? null,
    avatarUrl: row.avatar_url,
    online: isUserOnline(row.id),
  };
}

export function lookupUserByEmail(
  _hubOrCloudDb: CoreDatabase,
  email: string,
  excludeUserId?: string
): DmUserSummary | null {
  const row = getCloudDb()
    .prepare(
      `SELECT id, email, display_name, username, avatar_url
       FROM users WHERE email = ? AND id <> 'system-local'`
    )
    .get(email.trim().toLowerCase()) as
    | {
        id: string;
        email: string;
        display_name: string;
        username: string | null;
        avatar_url: string | null;
      }
    | undefined;
  if (!row || row.id === excludeUserId) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    username: row.username ?? null,
    avatarUrl: row.avatar_url,
    online: isUserOnline(row.id),
  };
}

export function listDmContacts(
  _hubDb: CoreDatabase,
  userId: string,
  emailLookup?: string
): DmContact[] {
  const cloud = getCloudDb();
  const byId = new Map<string, DmContact>();

  const shareRows = cloud
    .prepare(
      `SELECT DISTINCT
         CASE WHEN g.owner_user_id = ? THEN g.grantee_user_id ELSE g.owner_user_id END AS other_id
       FROM share_grants g
       WHERE (g.owner_user_id = ? OR g.grantee_user_id = ?)
         AND g.grantee_user_id IS NOT NULL
         AND (CASE WHEN g.owner_user_id = ? THEN g.grantee_user_id ELSE g.owner_user_id END) <> 'system-local'`
    )
    .all(userId, userId, userId, userId) as Array<{ other_id: string }>;

  for (const row of shareRows) {
    if (!row.other_id || row.other_id === userId) continue;
    const user = userSummary(cloud, row.other_id);
    if (user) byId.set(user.id, { ...user, relationship: "share" });
  }

  const tenantRows = cloud
    .prepare(
      `SELECT DISTINCT m2.user_id AS other_id
       FROM tenant_memberships m1
       JOIN tenant_memberships m2 ON m2.tenant_id = m1.tenant_id
       WHERE m1.user_id = ? AND m2.user_id <> ? AND m2.user_id <> 'system-local'`
    )
    .all(userId, userId) as Array<{ other_id: string }>;

  for (const row of tenantRows) {
    if (byId.has(row.other_id)) continue;
    const user = userSummary(cloud, row.other_id);
    if (user) byId.set(user.id, { ...user, relationship: "tenant" });
  }

  if (emailLookup?.trim()) {
    const found = lookupUserByEmail(cloud, emailLookup, userId);
    if (found) {
      byId.set(found.id, {
        ...found,
        relationship: byId.has(found.id) ? byId.get(found.id)!.relationship : "lookup",
      });
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );
}

export function isConversationMember(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM dm_conversation_members
       WHERE conversation_id = ? AND user_id = ?`
    )
    .get(conversationId, userId);
  return Boolean(row);
}

export function getConversationMemberRole(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): DmMemberRole | null {
  const row = db
    .prepare(
      `SELECT role FROM dm_conversation_members
       WHERE conversation_id = ? AND user_id = ?`
    )
    .get(conversationId, userId) as { role: DmMemberRole } | undefined;
  return row?.role ?? null;
}

export function assertConversationMember(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): DmMemberRole {
  const role = getConversationMemberRole(db, conversationId, userId);
  if (!role) throw new DmError("Not a member of this conversation", 403);
  return role;
}

/** Read access: members, or anyone for public lobby channels. */
export function assertConversationReadable(
  db: CoreDatabase,
  conversationId: string,
  _userId: string
): void {
  if (isPublicConversation(db, conversationId)) return;
  assertConversationMember(db, conversationId, _userId);
}

/** Effective public-channel role. No membership row ⇒ visitor. */
export function getPublicChannelRole(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): PublicChannelRole {
  if (!isPublicConversation(db, conversationId)) {
    throw new DmError("Not a public channel", 400);
  }
  const role = getConversationMemberRole(db, conversationId, userId);
  if (role === "admin") return "admin";
  if (role === "moderator") return "moderator";
  if (role === "member" || role === "owner") return "member";
  if (role === "visitor") return "visitor";
  return "visitor";
}

export function canModeratePublicMessages(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): boolean {
  const role = getPublicChannelRole(db, conversationId, userId);
  return role === "admin" || role === "moderator";
}

export function assertChannelModerator(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): void {
  if (!canModeratePublicMessages(db, conversationId, userId)) {
    throw new DmError("Channel moderator or admin required", 403);
  }
}

export function assertChannelAdmin(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): void {
  if (getPublicChannelRole(db, conversationId, userId) !== "admin") {
    throw new DmError("Channel admin required", 403);
  }
}

/** Channel-agent content writes require Admin on the bound public channel. */
export function assertCanEditChannelAgentContent(
  db: CoreDatabase,
  userId: string,
  agentId: string
): void {
  if (!isChannelAgentId(agentId)) return;
  const slug = slugFromChannelAgentId(agentId);
  if (!slug) throw new DmError("Invalid channel agent", 400);
  const row = db
    .prepare(
      `SELECT id FROM dm_conversations WHERE kind = 'public' AND slug = ?`
    )
    .get(slug) as { id: string } | undefined;
  if (!row) throw new DmError("Channel not found for agent", 404);
  assertChannelAdmin(db, row.id, userId);
}

function ensureMemberRoleOnPublicSend(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): void {
  const role = getConversationMemberRole(db, conversationId, userId);
  if (role === "admin" || role === "moderator" || role === "member") return;
  if (role === "visitor") {
    db.prepare(
      `UPDATE dm_conversation_members
       SET role = 'member'
       WHERE conversation_id = ? AND user_id = ? AND role = 'visitor'`
    ).run(conversationId, userId);
    return;
  }
  addMember(db, conversationId, userId, "member");
}

export function setPublicChannelMemberRole(
  db: CoreDatabase,
  opts: {
    conversationId: string;
    actorUserId: string;
    targetUserId: string;
    role: PublicChannelRole;
  }
): void {
  assertChannelAdmin(db, opts.conversationId, opts.actorUserId);
  if (opts.targetUserId === opts.actorUserId && opts.role !== "admin") {
    throw new DmError("Cannot demote yourself from admin", 400);
  }
  const existing = getConversationMemberRole(
    db,
    opts.conversationId,
    opts.targetUserId
  );
  if (!existing) {
    addMember(db, opts.conversationId, opts.targetUserId, opts.role);
    return;
  }
  db.prepare(
    `UPDATE dm_conversation_members
     SET role = ?
     WHERE conversation_id = ? AND user_id = ? AND member_kind = 'user'`
  ).run(opts.role, opts.conversationId, opts.targetUserId);
}

export function softDeleteMessage(
  db: CoreDatabase,
  opts: {
    conversationId: string;
    messageId: string;
    actorUserId: string;
  }
): DmMessageView {
  assertConversationReadable(db, opts.conversationId, opts.actorUserId);
  const msg = db
    .prepare(
      `SELECT * FROM dm_messages WHERE id = ? AND conversation_id = ?`
    )
    .get(opts.messageId, opts.conversationId) as CoreDmMessage | undefined;
  if (!msg) throw new DmError("Message not found", 404);
  if (msg.deleted_at) return mapMessageView(db, msg);

  const isOwn = msg.sender_user_id === opts.actorUserId;
  const canMod =
    isPublicConversation(db, opts.conversationId) &&
    canModeratePublicMessages(db, opts.conversationId, opts.actorUserId);
  if (!isOwn && !canMod) {
    throw new DmError("Not allowed to delete this message", 403);
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE dm_messages SET deleted_at = ?, body_text = '' WHERE id = ?`
  ).run(now, opts.messageId);
  const updated = db
    .prepare(`SELECT * FROM dm_messages WHERE id = ?`)
    .get(opts.messageId) as CoreDmMessage;
  return mapMessageView(db, updated);
}

function findDirectConversation(
  db: CoreDatabase,
  userA: string,
  userB: string
): CoreDmConversation | null {
  return (
    (db
      .prepare(
        `SELECT c.*
         FROM dm_conversations c
         JOIN dm_conversation_members m1
           ON m1.conversation_id = c.id AND m1.user_id = ?
         JOIN dm_conversation_members m2
           ON m2.conversation_id = c.id AND m2.user_id = ?
         WHERE c.kind = 'direct'
           AND (SELECT COUNT(*) FROM dm_conversation_members WHERE conversation_id = c.id) = 2
         LIMIT 1`
      )
      .get(userA, userB) as CoreDmConversation | undefined) ?? null
  );
}

function findDirectUserAgentConversation(
  db: CoreDatabase,
  userId: string,
  agentId: string
): CoreDmConversation | null {
  return (
    (db
      .prepare(
        `SELECT c.*
         FROM dm_conversations c
         JOIN dm_conversation_members mu
           ON mu.conversation_id = c.id
          AND mu.user_id = ?
          AND mu.member_kind = 'user'
         JOIN dm_conversation_members ma
           ON ma.conversation_id = c.id
          AND ma.member_kind = 'agent'
          AND ma.agent_id = ?
         WHERE c.kind = 'direct'
           AND (SELECT COUNT(*) FROM dm_conversation_members WHERE conversation_id = c.id) = 2
         LIMIT 1`
      )
      .get(userId, agentId) as CoreDmConversation | undefined) ?? null
  );
}

/** Open or create a 1:1 DM with a tenant agent (Intelligence, Digital You, …). */
export function ensureAgentDirectConversation(
  db: CoreDatabase,
  opts: {
    userId: string;
    agentId: string;
    agentTenantId: string;
  }
): DmConversationView {
  const agentTenantId = isChannelAgentId(opts.agentId)
    ? getOperatorTenantId(getCloudDb()) ?? opts.agentTenantId
    : opts.agentTenantId;
  const existing = findDirectUserAgentConversation(
    db,
    opts.userId,
    opts.agentId
  );
  if (existing) return buildConversationView(db, existing, opts.userId);
  return createConversation(db, {
    creatorUserId: opts.userId,
    kind: "direct",
    memberUserIds: [],
    memberAgents: [
      { agentId: opts.agentId, agentTenantId },
    ],
  });
}

/**
 * When a human posts in a public channel and @mentions a channel agent
 * (`@general`, `@local`, …), mirror the message into a 1:1 DM with that agent.
 */
export function routeChannelAgentMentionsToDm(
  db: CoreDatabase,
  opts: {
    sourceConversationId: string;
    senderUserId: string;
    bodyText: string;
    agentTenantId: string;
  }
): Array<{ agentId: string; conversationId: string; message: DmMessageView }> {
  if (!isPublicConversation(db, opts.sourceConversationId)) return [];
  const text = (opts.bodyText ?? "").trim();
  if (!text) return [];
  const mentions = resolveMentionsInText(text);
  const routed: Array<{
    agentId: string;
    conversationId: string;
    message: DmMessageView;
  }> = [];
  const seen = new Set<string>();
  for (const m of mentions) {
    if (m.subjectKind !== "agent") continue;
    if (!isChannelAgentId(m.subjectId)) continue;
    if (seen.has(m.subjectId)) continue;
    seen.add(m.subjectId);
    const dm = ensureAgentDirectConversation(db, {
      userId: opts.senderUserId,
      agentId: m.subjectId,
      agentTenantId: opts.agentTenantId,
    });
    if (dm.id === opts.sourceConversationId) continue;
    const message = createMessage(db, {
      conversationId: dm.id,
      senderUserId: opts.senderUserId,
      bodyText: text,
    });
    routed.push({
      agentId: m.subjectId,
      conversationId: dm.id,
      message,
    });
  }
  return routed;
}

function conversationDisplayTitle(
  db: CoreDatabase,
  conv: CoreDmConversation,
  viewerId: string
): string {
  if (conv.kind === "public") {
    const slug = conv.slug?.trim();
    if (slug) return `#${slug.replace(/^#/, "")}`;
    return conv.title?.trim() || "#channel";
  }
  if (conv.kind === "group" && conv.title?.trim()) return conv.title.trim();
  const memberRows = db
    .prepare(`SELECT * FROM dm_conversation_members WHERE conversation_id = ?`)
    .all(conv.id) as Array<{
    user_id: string;
    member_kind?: DmMemberKind;
    agent_id?: string | null;
    agent_tenant_id?: string | null;
  }>;
  const names: string[] = [];
  for (const m of memberRows) {
    const kind = m.member_kind ?? "user";
    if (kind === "agent" && m.agent_id && m.agent_tenant_id) {
      const agent = agentSummary(m.agent_tenant_id, m.agent_id);
      if (agent) names.push(agent.name);
      continue;
    }
    if (m.user_id === viewerId) continue;
    const user = userSummary(db, m.user_id);
    if (user) names.push(user.displayName);
  }
  return names.join(", ") || "Conversation";
}

function unreadCountForMember(
  db: CoreDatabase,
  conversationId: string,
  member: { last_read_at: string | null; last_read_message_id: string | null }
): number {
  if (member.last_read_message_id) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM dm_messages
         WHERE conversation_id = ?
           AND deleted_at IS NULL
           AND created_at > (
             SELECT created_at FROM dm_messages WHERE id = ?
           )`
      )
      .get(conversationId, member.last_read_message_id) as { n: number };
    return row.n;
  }
  if (member.last_read_at) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM dm_messages
         WHERE conversation_id = ?
           AND deleted_at IS NULL
           AND created_at > ?`
      )
      .get(conversationId, member.last_read_at) as { n: number };
    return row.n;
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM dm_messages
       WHERE conversation_id = ? AND deleted_at IS NULL`
    )
    .get(conversationId) as { n: number };
  return row.n;
}

function buildConversationView(
  db: CoreDatabase,
  conv: CoreDmConversation,
  viewerId: string
): DmConversationView {
  const memberRows = db
    .prepare(
      `SELECT * FROM dm_conversation_members WHERE conversation_id = ?`
    )
    .all(conv.id) as Array<{
    conversation_id: string;
    user_id: string;
    role: DmMemberRole;
    joined_at: string;
    last_read_at: string | null;
    last_read_message_id: string | null;
    member_kind?: DmMemberKind;
    agent_id?: string | null;
    agent_tenant_id?: string | null;
  }>;

  const viewerMember = memberRows.find(
    (m) => (m.member_kind ?? "user") === "user" && m.user_id === viewerId
  );
  const publicFacing = conv.kind === "public";
  const members: DmConversationMemberView[] = memberRows
    .map((m) => {
      const kind = m.member_kind ?? "user";
      if (kind === "agent" && m.agent_id && m.agent_tenant_id) {
        return {
          memberKind: "agent" as const,
          userId: null,
          role: m.role,
          joinedAt: m.joined_at,
          lastReadAt: m.last_read_at,
          user: null,
          agentId: m.agent_id,
          agentTenantId: m.agent_tenant_id,
          agent: agentSummary(m.agent_tenant_id, m.agent_id),
        };
      }
      const user = userSummary(db, m.user_id, { redactEmail: publicFacing });
      if (!user) return null;
      return {
        memberKind: "user" as const,
        userId: m.user_id,
        role: m.role,
        joinedAt: m.joined_at,
        lastReadAt: m.last_read_at,
        user,
        agentId: null,
        agentTenantId: null,
        agent: null,
      };
    })
    .filter(Boolean) as DmConversationMemberView[];

  return {
    id: conv.id,
    kind: conv.kind,
    title: conv.title,
    slug: conv.slug ?? null,
    plane:
      conv.kind === "public"
        ? isCloudLobbySlug(conv.slug)
          ? "cloud"
          : "install"
        : undefined,
    createdByUserId: conv.created_by_user_id,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    lastMessageAt: conv.last_message_at,
    lastMessagePreview: conv.last_message_preview,
    unreadCount: viewerMember
      ? unreadCountForMember(db, conv.id, viewerMember)
      : 0,
    members,
    displayTitle: conversationDisplayTitle(db, conv, viewerId),
  };
}

export function listConversationsForUser(
  db: CoreDatabase,
  userId: string
): DmConversationView[] {
  const rows = db
    .prepare(
      `SELECT c.*
       FROM dm_conversations c
       JOIN dm_conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = ?
         AND c.kind IN ('direct', 'group')
       ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC`
    )
    .all(userId) as CoreDmConversation[];
  const privateViews = rows.map((c) => buildConversationView(db, c, userId));
  const publicViews = listInstallPublicChannels(db).map((ch) => {
    const conv = getPublicChannelById(db, ch.id)!;
    return buildConversationView(db, conv, userId);
  });
  return [...publicViews, ...privateViews];
}

export function getConversationForUser(
  db: CoreDatabase,
  conversationId: string,
  userId: string
): DmConversationView {
  assertConversationReadable(db, conversationId, userId);
  const conv = db
    .prepare(`SELECT * FROM dm_conversations WHERE id = ?`)
    .get(conversationId) as CoreDmConversation | undefined;
  if (!conv) throw new DmError("Conversation not found", 404);
  return buildConversationView(db, conv, userId);
}

function addMember(
  db: CoreDatabase,
  conversationId: string,
  userId: string,
  role: DmMemberRole
): void {
  db.prepare(
    `INSERT OR IGNORE INTO dm_conversation_members
       (conversation_id, user_id, role, member_kind)
     VALUES (?, ?, ?, 'user')`
  ).run(conversationId, userId, role);
}

export interface DmAgentMemberInput {
  agentId: string;
  agentTenantId: string;
}

function addAgentMember(
  db: CoreDatabase,
  conversationId: string,
  agent: DmAgentMemberInput,
  role: DmMemberRole = "member"
): void {
  db.prepare(
    `INSERT OR IGNORE INTO dm_conversation_members
       (conversation_id, user_id, role, member_kind, agent_id, agent_tenant_id)
     VALUES (?, ?, ?, 'agent', ?, ?)`
  ).run(
    conversationId,
    agentMemberUserId(agent.agentId),
    role,
    agent.agentId,
    agent.agentTenantId
  );
}

export function listConversationAgents(
  db: CoreDatabase,
  conversationId: string
): DmAgentMemberInput[] {
  return (
    db
      .prepare(
        `SELECT agent_id, agent_tenant_id FROM dm_conversation_members
         WHERE conversation_id = ? AND member_kind = 'agent'
           AND agent_id IS NOT NULL AND agent_tenant_id IS NOT NULL`
      )
      .all(conversationId) as Array<{
      agent_id: string;
      agent_tenant_id: string;
    }>
  ).map((r) => ({ agentId: r.agent_id, agentTenantId: r.agent_tenant_id }));
}

export function createConversation(
  db: CoreDatabase,
  opts: {
    creatorUserId: string;
    kind: DmConversationKind;
    title?: string | null;
    memberUserIds: string[];
    memberAgents?: DmAgentMemberInput[];
  }
): DmConversationView {
  const uniqueMembers = Array.from(
    new Set([opts.creatorUserId, ...opts.memberUserIds])
  ).filter((id) => id !== "system-local");
  const uniqueAgents = Array.from(
    new Map(
      (opts.memberAgents ?? []).map((a) => [`${a.agentTenantId}:${a.agentId}`, a])
    ).values()
  );
  const totalParticipants = uniqueMembers.length + uniqueAgents.length;

  if (opts.kind === "public") {
    throw new DmError("Public channels are seeded by the platform");
  }
  if (opts.kind === "direct") {
    if (totalParticipants !== 2) {
      throw new DmError("Direct conversations require exactly two participants");
    }
    if (uniqueAgents.length === 0 && uniqueMembers.length === 2) {
      const existing = findDirectConversation(
        db,
        uniqueMembers[0]!,
        uniqueMembers[1]!
      );
      if (existing) return buildConversationView(db, existing, opts.creatorUserId);
    }
    if (uniqueAgents.length === 1 && uniqueMembers.length === 1) {
      const existing = findDirectUserAgentConversation(
        db,
        uniqueMembers[0]!,
        uniqueAgents[0]!.agentId
      );
      if (existing) return buildConversationView(db, existing, opts.creatorUserId);
    }
  } else if (totalParticipants < 2) {
    throw new DmError("Group conversations require at least two participants");
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dm_conversations
       (id, kind, title, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.kind,
    opts.kind === "group" ? (opts.title?.trim() || null) : null,
    opts.creatorUserId,
    now,
    now
  );

  for (const memberId of uniqueMembers) {
    addMember(
      db,
      id,
      memberId,
      memberId === opts.creatorUserId ? "owner" : "member"
    );
  }
  for (const agent of uniqueAgents) {
    addAgentMember(db, id, agent, "member");
  }

  const conv = db
    .prepare(`SELECT * FROM dm_conversations WHERE id = ?`)
    .get(id) as CoreDmConversation;
  return buildConversationView(db, conv, opts.creatorUserId);
}

function mapAttachment(
  row: CoreDmMessageAttachment
): DmAttachmentView {
  return {
    id: row.id,
    kind: row.kind,
    blobId: row.blob_id,
    href:
      row.kind === "resource_ref"
        ? row.href
        : row.blob_id
          ? blobHref(row.blob_id)
          : null,
    resourceKind: row.resource_kind,
    resourceId: row.resource_id,
    label: row.label,
    mime: row.mime,
    size: row.size,
  };
}

export function listMessages(
  db: CoreDatabase,
  conversationId: string,
  userId: string,
  opts?: { before?: string; limit?: number }
): DmMessageView[] {
  assertConversationReadable(db, conversationId, userId);
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const rows = opts?.before
    ? (db
        .prepare(
          `SELECT m.* FROM dm_messages m
           WHERE m.conversation_id = ?
             AND m.created_at < (SELECT created_at FROM dm_messages WHERE id = ?)
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(conversationId, opts.before, limit) as CoreDmMessage[])
    : (db
        .prepare(
          `SELECT m.* FROM dm_messages m
           WHERE m.conversation_id = ?
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(conversationId, limit) as CoreDmMessage[]);

  return rows.reverse().map((m) => mapMessageView(db, m));
}

function mapMessageView(db: CoreDatabase, m: CoreDmMessage): DmMessageView {
  const senderKind = (m.sender_kind ?? "user") as DmSenderKind;
  const attachments = db
    .prepare(`SELECT * FROM dm_message_attachments WHERE message_id = ?`)
    .all(m.id) as CoreDmMessageAttachment[];
  const bodyText = m.deleted_at ? "" : m.body_text;
  const mentions = bodyText
    ? resolveMentionsInText(bodyText).map((x) => ({
        handle: x.handle,
        subjectKind: x.subjectKind,
        subjectId: x.subjectId,
        agentTenantId: x.agentTenantId ?? null,
      }))
    : [];

  if (senderKind === "agent" && m.sender_agent_id && m.sender_agent_tenant_id) {
    return {
      id: m.id,
      conversationId: m.conversation_id,
      senderKind: "agent",
      senderUserId: null,
      sender: null,
      senderAgentId: m.sender_agent_id,
      senderAgent: agentSummary(m.sender_agent_tenant_id, m.sender_agent_id),
      bodyText,
      createdAt: m.created_at,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      attachments: attachments.map(mapAttachment),
      mentions,
    };
  }

  const publicFacing = isPublicConversation(db, m.conversation_id);
  const sender = userSummary(db, m.sender_user_id, {
    redactEmail: publicFacing,
  });
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderKind: "user",
    senderUserId: m.sender_user_id,
    sender: sender ?? {
      id: m.sender_user_id,
      email: "",
      displayName: "Unknown",
      username: null,
      avatarUrl: null,
      online: false,
    },
    senderAgentId: null,
    senderAgent: null,
    bodyText,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    deletedAt: m.deleted_at,
    attachments: attachments.map(mapAttachment),
    mentions,
  };
}

function notifyMentionedUsers(opts: {
  conversationId: string;
  senderUserId: string;
  bodyText: string;
  messageId: string;
}): void {
  const mentions = resolveMentionsInText(opts.bodyText);
  const sender = userSummary(getCloudDb(), opts.senderUserId);
  const fromLabel = sender?.username
    ? `@${sender.username}`
    : sender?.displayName || "Someone";
  for (const m of mentions) {
    if (m.subjectKind !== "user") continue;
    if (m.subjectId === opts.senderUserId) continue;
    try {
      createNotification({
        recipientKind: "user",
        recipientId: m.subjectId,
        category: "mention",
        title: `${fromLabel} mentioned you`,
        body: opts.bodyText.slice(0, 200),
        link: `/chat?conversation=${opts.conversationId}`,
        resourceKind: "dm_message",
        resourceId: opts.messageId,
      });
    } catch {
      /* notifications optional on Local / missing hub */
    }
  }
}

export function createMessage(
  db: CoreDatabase,
  opts: {
    conversationId: string;
    senderUserId: string;
    bodyText?: string;
    attachments?: DmAttachmentInput[];
  }
): DmMessageView {
  if (isPublicConversation(db, opts.conversationId)) {
    if (
      !canSendToPublicConversation(
        db,
        opts.conversationId,
        opts.senderUserId
      )
    ) {
      throw new DmError(
        publicSendDeniedMessage(db, opts.conversationId),
        402
      );
    }
    ensureMemberRoleOnPublicSend(
      db,
      opts.conversationId,
      opts.senderUserId
    );
  } else {
    assertConversationMember(db, opts.conversationId, opts.senderUserId);
  }
  const text = (opts.bodyText ?? "").trim();
  const attachments = opts.attachments ?? [];
  if (!text && attachments.length === 0) {
    throw new DmError("Message must have text or attachments");
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dm_messages
       (id, conversation_id, sender_user_id, body_text, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, opts.conversationId, opts.senderUserId, text, now);

  for (const att of attachments) {
    const attId = uuidv4();
    if (att.kind === "resource_ref") {
      db.prepare(
        `INSERT INTO dm_message_attachments
           (id, message_id, kind, resource_kind, resource_id, label, href)
         VALUES (?, ?, 'resource_ref', ?, ?, ?, ?)`
      ).run(
        attId,
        id,
        att.resourceKind ?? null,
        att.resourceId ?? null,
        att.label ?? null,
        att.href ?? null
      );
    } else if (att.blobId) {
      db.prepare(
        `INSERT INTO dm_message_attachments
           (id, message_id, kind, blob_id, mime, size)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        attId,
        id,
        att.kind,
        att.blobId,
        att.mime ?? null,
        att.size ?? null
      );
    }
  }

  const preview =
    text ||
    (attachments[0]?.label
      ? `[${attachments[0].label}]`
      : attachments[0]?.kind === "image"
        ? "[image]"
        : attachments[0]?.kind === "file"
          ? "[file]"
          : "[attachment]");

  db.prepare(
    `UPDATE dm_conversations
     SET updated_at = ?, last_message_at = ?, last_message_preview = ?
     WHERE id = ?`
  ).run(now, now, preview.slice(0, 200), opts.conversationId);

  db.prepare(
    `UPDATE dm_conversation_members
     SET last_read_at = ?, last_read_message_id = ?
     WHERE conversation_id = ? AND user_id = ?`
  ).run(now, id, opts.conversationId, opts.senderUserId);

  const msg = db
    .prepare(`SELECT * FROM dm_messages WHERE id = ?`)
    .get(id) as CoreDmMessage;
  if (text) {
    notifyMentionedUsers({
      conversationId: opts.conversationId,
      senderUserId: opts.senderUserId,
      bodyText: text,
      messageId: id,
    });
  }
  return mapMessageView(db, msg);
}

export function createAgentMessage(
  db: CoreDatabase,
  opts: {
    conversationId: string;
    agentId: string;
    agentTenantId: string;
    bodyText: string;
    attachments?: DmAttachmentInput[];
  }
): DmMessageView {
  const text = (opts.bodyText ?? "").trim();
  const attachments = opts.attachments ?? [];
  if (!text && attachments.length === 0) {
    throw new DmError("Message must have text or attachments");
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dm_messages
       (id, conversation_id, sender_user_id, body_text, created_at,
        sender_kind, sender_agent_id, sender_agent_tenant_id)
     VALUES (?, ?, 'system-local', ?, ?, 'agent', ?, ?)`
  ).run(
    id,
    opts.conversationId,
    text,
    now,
    opts.agentId,
    opts.agentTenantId
  );

  for (const att of attachments) {
    const attId = uuidv4();
    if (att.kind === "resource_ref") {
      db.prepare(
        `INSERT INTO dm_message_attachments
           (id, message_id, kind, resource_kind, resource_id, label, href)
         VALUES (?, ?, 'resource_ref', ?, ?, ?, ?)`
      ).run(
        attId,
        id,
        att.resourceKind ?? null,
        att.resourceId ?? null,
        att.label ?? null,
        att.href ?? null
      );
    } else if (att.blobId) {
      db.prepare(
        `INSERT INTO dm_message_attachments
           (id, message_id, kind, blob_id, mime, size)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        attId,
        id,
        att.kind,
        att.blobId,
        att.mime ?? null,
        att.size ?? null
      );
    }
  }

  const preview =
    text ||
    (attachments[0]?.label
      ? `[${attachments[0].label}]`
      : attachments[0]?.kind === "image"
        ? "[image]"
        : "[attachment]");

  db.prepare(
    `UPDATE dm_conversations
     SET updated_at = ?, last_message_at = ?, last_message_preview = ?
     WHERE id = ?`
  ).run(now, now, preview.slice(0, 200), opts.conversationId);

  const msg = db
    .prepare(`SELECT * FROM dm_messages WHERE id = ?`)
    .get(id) as CoreDmMessage;
  return mapMessageView(db, msg);
}

export function markConversationRead(
  db: CoreDatabase,
  conversationId: string,
  userId: string,
  messageId?: string
): void {
  assertConversationReadable(db, conversationId, userId);
  // Public readers without a membership row have nothing to update.
  if (!isConversationMember(db, conversationId, userId)) return;
  const now = new Date().toISOString();
  if (messageId) {
    const exists = db
      .prepare(
        `SELECT id FROM dm_messages WHERE id = ? AND conversation_id = ?`
      )
      .get(messageId, conversationId);
    if (!exists) throw new DmError("Message not found", 404);
    db.prepare(
      `UPDATE dm_conversation_members
       SET last_read_at = ?, last_read_message_id = ?
       WHERE conversation_id = ? AND user_id = ?`
    ).run(now, messageId, conversationId, userId);
    return;
  }
  const latest = db
    .prepare(
      `SELECT id FROM dm_messages
       WHERE conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(conversationId) as { id: string } | undefined;
  db.prepare(
    `UPDATE dm_conversation_members
     SET last_read_at = ?, last_read_message_id = ?
     WHERE conversation_id = ? AND user_id = ?`
  ).run(now, latest?.id ?? null, conversationId, userId);
}

export function addConversationMember(
  db: CoreDatabase,
  conversationId: string,
  actorUserId: string,
  newUserId: string
): DmConversationMemberView {
  const role = assertConversationMember(db, conversationId, actorUserId);
  const conv = db
    .prepare(`SELECT kind FROM dm_conversations WHERE id = ?`)
    .get(conversationId) as { kind: DmConversationKind } | undefined;
  if (!conv) throw new DmError("Conversation not found", 404);
  if (conv.kind !== "group") throw new DmError("Cannot add members to a direct chat");
  if (role !== "owner") throw new DmError("Only owners can add members", 403);
  if (isConversationMember(db, conversationId, newUserId)) {
    throw new DmError("User is already a member");
  }
  addMember(db, conversationId, newUserId, "member");
  const user = userSummary(db, newUserId);
  if (!user) throw new DmError("User not found", 404);
  const row = db
    .prepare(
      `SELECT * FROM dm_conversation_members
       WHERE conversation_id = ? AND user_id = ?`
    )
    .get(conversationId, newUserId) as {
    joined_at: string;
    last_read_at: string | null;
  };
  return {
    memberKind: "user",
    userId: newUserId,
    role: "member",
    joinedAt: row.joined_at,
    lastReadAt: row.last_read_at,
    user,
    agentId: null,
    agentTenantId: null,
    agent: null,
  };
}

export function removeConversationMember(
  db: CoreDatabase,
  conversationId: string,
  actorUserId: string,
  targetUserId: string
): void {
  const actorRole = assertConversationMember(db, conversationId, actorUserId);
  const conv = db
    .prepare(`SELECT kind FROM dm_conversations WHERE id = ?`)
    .get(conversationId) as { kind: DmConversationKind } | undefined;
  if (!conv) throw new DmError("Conversation not found", 404);
  if (conv.kind !== "group") throw new DmError("Cannot remove members from a direct chat");
  if (actorRole !== "owner" && actorUserId !== targetUserId) {
    throw new DmError("Only owners can remove other members", 403);
  }
  if (!isConversationMember(db, conversationId, targetUserId)) {
    throw new DmError("User is not a member", 404);
  }
  db.prepare(
    `DELETE FROM dm_conversation_members
     WHERE conversation_id = ? AND user_id = ?`
  ).run(conversationId, targetUserId);
}

export function listConversationMemberUserIds(
  db: CoreDatabase,
  conversationId: string
): string[] {
  return (
    db
      .prepare(
        `SELECT user_id FROM dm_conversation_members
         WHERE conversation_id = ?
           AND (member_kind IS NULL OR member_kind = 'user')
           AND user_id NOT LIKE 'agent:%'`
      )
      .all(conversationId) as Array<{ user_id: string }>
  ).map((r) => r.user_id);
}

export function userCanAccessBlob(
  db: CoreDatabase,
  blobId: string,
  userId: string
): boolean {
  const blob = db
    .prepare(`SELECT owner_user_id FROM dm_blobs WHERE id = ?`)
    .get(blobId) as { owner_user_id: string } | undefined;
  if (!blob) return false;
  if (blob.owner_user_id === userId) return true;
  const row = db
    .prepare(
      `SELECT 1
       FROM dm_message_attachments a
       JOIN dm_messages m ON m.id = a.message_id
       JOIN dm_conversation_members cm ON cm.conversation_id = m.conversation_id
       WHERE a.blob_id = ? AND cm.user_id = ?`
    )
    .get(blobId, userId);
  return Boolean(row);
}

export function shareResourceToConversation(
  db: CoreDatabase,
  opts: {
    conversationId: string;
    actorUserId: string;
    actorTenantId: string;
    resourceKind: MarketplaceListingKind;
    resourceId: string;
    role?: ShareGrantRole;
  }
): Array<{ granteeUserId: string; grantId: string }> {
  assertConversationMember(db, opts.conversationId, opts.actorUserId);
  const memberIds = listConversationMemberUserIds(db, opts.conversationId).filter(
    (id) => id !== opts.actorUserId
  );
  const results: Array<{ granteeUserId: string; grantId: string }> = [];
  for (const granteeUserId of memberIds) {
    const grantId = createShareGrant(db, {
      ownerTenantId: opts.actorTenantId,
      ownerUserId: opts.actorUserId,
      resourceKind: opts.resourceKind,
      resourceId: opts.resourceId,
      granteeUserId,
      role: opts.role ?? "viewer",
    });
    results.push({ granteeUserId, grantId });
  }
  return results;
}

export function totalUnreadForUser(db: CoreDatabase, userId: string): number {
  const convs = listConversationsForUser(db, userId);
  return convs.reduce((sum, c) => sum + c.unreadCount, 0);
}
