import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  authorizeFederationScCommand,
  validateScCommandLine,
} from "../../routes/federation.js";
import { authorizeTypingEvent } from "../../routes/dm.js";

function federationDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE share_grants (
      id TEXT PRIMARY KEY,
      owner_tenant_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      grantee_user_id TEXT,
      grantee_tenant_id TEXT,
      role TEXT NOT NULL,
      federation_token TEXT,
      expires_at TEXT
    );
    CREATE TABLE tenant_memberships (
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO share_grants
       (id, owner_tenant_id, resource_kind, resource_id, grantee_tenant_id,
        role, federation_token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "grant-1",
    "owner-tenant",
    "department",
    "resource-1",
    "target-tenant",
    "editor",
    "sc-token",
    new Date(Date.now() + 60_000).toISOString()
  );
  return db;
}

const validBinding = {
  verb: "execute",
  resourceKind: "department",
  resourceId: "resource-1",
  ownerTenantId: "owner-tenant",
  targetTenantId: "target-tenant",
};

describe("specialized route authorization", () => {
  it("binds SC tokens to verb, resource, tenants, role, and expiry", () => {
    const db = federationDb();
    expect(
      authorizeFederationScCommand(db, "sc-token", validBinding).id
    ).toBe("grant-1");

    for (const binding of [
      { ...validBinding, verb: "delete" },
      { ...validBinding, resourceId: "resource-2" },
      { ...validBinding, ownerTenantId: "other-owner" },
      { ...validBinding, targetTenantId: "other-target" },
    ]) {
      expect(() =>
        authorizeFederationScCommand(db, "sc-token", binding)
      ).toThrow();
    }
    db.prepare("UPDATE share_grants SET expires_at=? WHERE id=?").run(
      new Date(Date.now() - 60_000).toISOString(),
      "grant-1"
    );
    expect(() =>
      authorizeFederationScCommand(db, "sc-token", validBinding)
    ).toThrow(/expired/);
    db.close();
  });

  it("rejects arbitrary or injected SC command lines", () => {
    expect(validateScCommandLine("RECALC|4")).toBe("RECALC|4");
    expect(() => validateScCommandLine("DROP_DATABASE|now")).toThrow(
      /not permitted/
    );
    expect(() => validateScCommandLine("PING|ok\nFLATTEN|1")).toThrow(
      /Malformed/
    );
  });

  it("requires DM membership and authenticated sender identity", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE dm_conversation_members (
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        member_kind TEXT
      );
      INSERT INTO dm_conversation_members
        (conversation_id, user_id, role, member_kind)
      VALUES
        ('conversation-1', 'user-1', 'member', 'user'),
        ('conversation-1', 'user-2', 'member', 'user');
    `);
    expect(
      authorizeTypingEvent(db, "conversation-1", "user-1", {
        userId: "user-1",
      })
    ).toEqual(["user-1", "user-2"]);
    expect(() =>
      authorizeTypingEvent(db, "conversation-1", "outsider", {})
    ).toThrow(/Not a member/);
    expect(() =>
      authorizeTypingEvent(db, "conversation-1", "user-1", {
        senderUserId: "user-2",
      })
    ).toThrow(/authenticated user/);
    db.close();
  });
});
