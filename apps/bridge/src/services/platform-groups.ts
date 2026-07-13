import { v4 as uuidv4 } from "uuid";
import {
  getCoreDb,
  type CoreDatabase,
} from "../core-db.js";

export const SUPPORT_GROUP_SLUG = "support";

export type PlatformGroupMemberKind = "user" | "agent";

export interface PlatformGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface PlatformGroupMember {
  group_id: string;
  member_kind: PlatformGroupMemberKind;
  member_id: string;
  /** Required for agents (tenant-scoped). Null for users. */
  tenant_id: string | null;
  created_at: string;
}

export function ensurePlatformGroups(db: CoreDatabase = getCoreDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_groups (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS platform_group_members (
      group_id TEXT NOT NULL REFERENCES platform_groups(id) ON DELETE CASCADE,
      member_kind TEXT NOT NULL CHECK (member_kind IN ('user', 'agent')),
      member_id TEXT NOT NULL,
      tenant_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, member_kind, member_id, tenant_id)
    );
    CREATE INDEX IF NOT EXISTS platform_group_members_lookup_idx
      ON platform_group_members(member_kind, member_id, tenant_id);
  `);

  const existing = db
    .prepare(`SELECT id FROM platform_groups WHERE slug = ?`)
    .get(SUPPORT_GROUP_SLUG);
  if (!existing) {
    db.prepare(
      `INSERT INTO platform_groups (id, slug, name, description)
       VALUES (?, ?, ?, ?)`
    ).run(
      uuidv4(),
      SUPPORT_GROUP_SLUG,
      "Support",
      "Users and agents who can answer hub and shared-resource support tickets."
    );
  }
}

export function getGroupBySlug(
  slug: string,
  db: CoreDatabase = getCoreDb()
): PlatformGroup | null {
  return (
    (db
      .prepare(`SELECT * FROM platform_groups WHERE slug = ?`)
      .get(slug) as PlatformGroup | undefined) ?? null
  );
}

export function listGroupMembers(
  groupId: string,
  db: CoreDatabase = getCoreDb()
): PlatformGroupMember[] {
  return db
    .prepare(
      `SELECT * FROM platform_group_members
       WHERE group_id = ?
       ORDER BY member_kind ASC, created_at ASC`
    )
    .all(groupId) as PlatformGroupMember[];
}

export function addGroupMember(
  input: {
    groupId: string;
    memberKind: PlatformGroupMemberKind;
    memberId: string;
    tenantId?: string | null;
  },
  db: CoreDatabase = getCoreDb()
): PlatformGroupMember {
  const tenantId =
    input.memberKind === "agent" ? (input.tenantId ?? null) : null;
  if (input.memberKind === "agent" && !tenantId) {
    throw new Error("tenantId is required for agent group members");
  }
  db.prepare(
    `INSERT OR IGNORE INTO platform_group_members
       (group_id, member_kind, member_id, tenant_id)
     VALUES (?, ?, ?, ?)`
  ).run(input.groupId, input.memberKind, input.memberId, tenantId ?? "");
  const row = db
    .prepare(
      `SELECT * FROM platform_group_members
       WHERE group_id = ? AND member_kind = ? AND member_id = ? AND tenant_id = ?`
    )
    .get(
      input.groupId,
      input.memberKind,
      input.memberId,
      tenantId ?? ""
    ) as PlatformGroupMember | undefined;
  if (!row) throw new Error("Failed to add group member");
  return { ...row, tenant_id: row.tenant_id || null };
}

export function removeGroupMember(
  input: {
    groupId: string;
    memberKind: PlatformGroupMemberKind;
    memberId: string;
    tenantId?: string | null;
  },
  db: CoreDatabase = getCoreDb()
): boolean {
  const tenantId =
    input.memberKind === "agent" ? (input.tenantId ?? "") : "";
  return (
    db
      .prepare(
        `DELETE FROM platform_group_members
         WHERE group_id = ? AND member_kind = ? AND member_id = ? AND tenant_id = ?`
      )
      .run(input.groupId, input.memberKind, input.memberId, tenantId).changes > 0
  );
}

export function isUserInGroup(
  slug: string,
  userId: string,
  db: CoreDatabase = getCoreDb()
): boolean {
  const row = db
    .prepare(
      `SELECT 1
       FROM platform_group_members m
       JOIN platform_groups g ON g.id = m.group_id
       WHERE g.slug = ? AND m.member_kind = 'user' AND m.member_id = ?
       LIMIT 1`
    )
    .get(slug, userId);
  return Boolean(row);
}

export function isAgentInGroup(
  slug: string,
  agentId: string,
  tenantId: string,
  db: CoreDatabase = getCoreDb()
): boolean {
  const row = db
    .prepare(
      `SELECT 1
       FROM platform_group_members m
       JOIN platform_groups g ON g.id = m.group_id
       WHERE g.slug = ?
         AND m.member_kind = 'agent'
         AND m.member_id = ?
         AND m.tenant_id = ?
       LIMIT 1`
    )
    .get(slug, agentId, tenantId);
  return Boolean(row);
}

export function listSupportStaffUserIds(db: CoreDatabase = getCoreDb()): string[] {
  const group = getGroupBySlug(SUPPORT_GROUP_SLUG, db);
  if (!group) return [];
  return (
    db
      .prepare(
        `SELECT member_id FROM platform_group_members
         WHERE group_id = ? AND member_kind = 'user'`
      )
      .all(group.id) as Array<{ member_id: string }>
  ).map((r) => r.member_id);
}

/** Platform admin or Support group member. */
export function canStaffSupportAsUser(
  user: { id: string; isAdmin?: boolean } | null | undefined,
  db: CoreDatabase = getCoreDb()
): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return isUserInGroup(SUPPORT_GROUP_SLUG, user.id, db);
}
