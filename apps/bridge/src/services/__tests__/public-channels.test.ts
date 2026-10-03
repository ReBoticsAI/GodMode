import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

const cloudMem = new Database(":memory:");
cloudMem.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    avatar_url TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    is_operator INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO tenants (id, is_operator) VALUES ('tenant-op', 1);
  INSERT INTO users (id, email, display_name, avatar_url, is_admin)
    VALUES
      ('admin-1', 'admin@example.com', 'Admin', NULL, 1),
      ('mod-1', 'mod@example.com', 'Mod', NULL, 0),
      ('member-1', 'member@example.com', 'Member', NULL, 0);
`);

vi.mock("../../core-db.js", () => ({
  getCloudDb: () => cloudMem,
  getOperatorTenantId: () => "tenant-op",
}));

vi.mock("../../config.js", () => ({
  config: { isSaas: false },
}));

const {
  CLOUD_LOBBY_SLUGS,
  INSTALL_LOCAL_SLUG,
  bindChannelAgentsToPublicConversations,
  channelAgentIdForSlug,
  ensurePublicChannelMemberRoles,
  ensurePublicChannelSchema,
  listInstallPublicChannels,
  seedPublicChannelCatalog,
} = await import("../public-channels.js");

const {
  assertCanEditChannelAgentContent,
  getPublicChannelRole,
  setPublicChannelMemberRole,
  softDeleteMessage,
  DmError,
} = await import("../dm-service.js");

function createHubDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE host_users_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE dm_conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
      title TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT,
      last_message_preview TEXT
    );
    CREATE TABLE dm_conversation_members (
      conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'member')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_read_at TEXT,
      last_read_message_id TEXT,
      member_kind TEXT NOT NULL DEFAULT 'user',
      agent_id TEXT,
      agent_tenant_id TEXT,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE TABLE dm_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL,
      body_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      edited_at TEXT,
      deleted_at TEXT,
      sender_kind TEXT NOT NULL DEFAULT 'user',
      sender_agent_id TEXT,
      sender_agent_tenant_id TEXT
    );
    CREATE TABLE dm_message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'file', 'resource_ref')),
      blob_id TEXT,
      resource_kind TEXT,
      resource_id TEXT,
      label TEXT,
      href TEXT,
      mime TEXT,
      size INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("public-channels", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createHubDb();
  });

  afterEach(() => {
    db.close();
  });

  it("migrates schema and seeds only #local on non-SaaS installs with agentId", () => {
    ensurePublicChannelSchema(db as never);
    const channels = listInstallPublicChannels(db as never);
    expect(channels.map((c) => c.slug)).toEqual([INSTALL_LOCAL_SLUG]);
    expect(channels[0]?.plane).toBe("install");
    expect(channels[0]?.displayTitle).toBe("#local");
    expect(channels[0]?.agentId).toBe(channelAgentIdForSlug(INSTALL_LOCAL_SLUG));
    seedPublicChannelCatalog(db as never);
    expect(listInstallPublicChannels(db as never)).toHaveLength(1);
    const cloudSlugs = db
      .prepare(
        `SELECT slug FROM dm_conversations WHERE kind = 'public' AND slug != ?`
      )
      .all(INSTALL_LOCAL_SLUG) as Array<{ slug: string }>;
    expect(cloudSlugs).toEqual([]);
    expect(CLOUD_LOBBY_SLUGS.length).toBe(5);
  });

  it("widens member roles CHECK and binds channel agents", () => {
    ensurePublicChannelSchema(db as never);
    ensurePublicChannelMemberRoles(db as never);
    bindChannelAgentsToPublicConversations(db as never);

    db.prepare(
      `INSERT INTO dm_conversation_members
         (conversation_id, user_id, role, member_kind)
       SELECT id, 'mod-1', 'moderator', 'user'
       FROM dm_conversations WHERE slug = ?`
    ).run(INSTALL_LOCAL_SLUG);

    const agentRow = db
      .prepare(
        `SELECT agent_id, member_kind, role
         FROM dm_conversation_members
         WHERE agent_id = ? AND member_kind = 'agent'`
      )
      .get(channelAgentIdForSlug(INSTALL_LOCAL_SLUG)) as
      | { agent_id: string; member_kind: string; role: string }
      | undefined;
    expect(agentRow?.agent_id).toBe("channel-local");
    expect(agentRow?.member_kind).toBe("agent");

    const adminPromo = db
      .prepare(
        `SELECT role FROM dm_conversation_members
         WHERE user_id = 'admin-1' AND conversation_id = (
           SELECT id FROM dm_conversations WHERE slug = ?
         )`
      )
      .get(INSTALL_LOCAL_SLUG) as { role: string } | undefined;
    expect(adminPromo?.role).toBe("admin");
  });

  it("treats missing membership as visitor; admin edits; moderator soft-deletes", () => {
    ensurePublicChannelSchema(db as never);
    const channelId = (
      db
        .prepare(`SELECT id FROM dm_conversations WHERE slug = ?`)
        .get(INSTALL_LOCAL_SLUG) as { id: string }
    ).id;

    expect(getPublicChannelRole(db as never, channelId, "nobody")).toBe(
      "visitor"
    );

    db.prepare(
      `INSERT INTO dm_conversation_members
         (conversation_id, user_id, role, member_kind)
       VALUES (?, 'mod-1', 'moderator', 'user'), (?, 'member-1', 'member', 'user')
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET role = excluded.role`
    ).run(channelId, channelId);
    // Platform admin was promoted during schema seed.
    expect(getPublicChannelRole(db as never, channelId, "admin-1")).toBe(
      "admin"
    );

    db.prepare(
      `INSERT INTO dm_messages (id, conversation_id, sender_user_id, body_text)
       VALUES ('m1', ?, 'member-1', 'hello')`
    ).run(channelId);

    expect(() =>
      assertCanEditChannelAgentContent(db as never, "mod-1", "channel-local")
    ).toThrow(DmError);
    expect(() =>
      assertCanEditChannelAgentContent(db as never, "admin-1", "channel-local")
    ).not.toThrow();

    const deleted = softDeleteMessage(db as never, {
      conversationId: channelId,
      messageId: "m1",
      actorUserId: "mod-1",
    });
    expect(deleted.deletedAt).toBeTruthy();
    expect(deleted.bodyText).toBe("");

    expect(() =>
      setPublicChannelMemberRole(db as never, {
        conversationId: channelId,
        actorUserId: "mod-1",
        targetUserId: "member-1",
        role: "moderator",
      })
    ).toThrow(DmError);

    setPublicChannelMemberRole(db as never, {
      conversationId: channelId,
      actorUserId: "admin-1",
      targetUserId: "member-1",
      role: "moderator",
    });
    expect(getPublicChannelRole(db as never, channelId, "member-1")).toBe(
      "moderator"
    );
  });
});
