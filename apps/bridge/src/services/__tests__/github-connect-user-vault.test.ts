/**
 * Personal Vault GitHub Connect on per-account User DB: share across workspaces.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot, tenantsDir, usersDir, cloudDbPath } = vi.hoisted(() => {
  const f = require("node:fs") as typeof import("node:fs");
  const o = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const root = f.mkdtempSync(p.join(o.tmpdir(), "gm-gh-connect-"));
  return {
    tmpRoot: root,
    tenantsDir: p.join(root, "tenants"),
    usersDir: p.join(root, "users"),
    cloudDbPath: p.join(root, "core.sqlite"),
  };
});

vi.mock("../../config.js", async () => {
  const actual = await vi.importActual<typeof import("../../config.js")>(
    "../../config.js"
  );
  return {
    ...actual,
    config: {
      ...actual.config,
      dataDir: tmpRoot,
      usersDir,
      tenantsDir,
      cloudDbPath,
    },
  };
});

import { getCloudDb } from "../../core-db.js";
import { getTenantDb, evictTenantDb } from "../../tenant-registry.js";
import {
  closeAllUserDbs,
  evictUserDb,
  getUserDb,
} from "../../user-registry.js";
import { listSecrets } from "../agents/agents-db.js";
import { encryptSecret } from "../holdings/crypto-box.js";
import {
  GITHUB_PROJECTS_SECRET_ID,
  GITHUB_PROJECTS_SECRET_NAME,
  clearGithubProjectsToken,
  migrateGithubConnectToUserVault,
  readGithubProjectsToken,
  upsertGithubProjectsToken,
  type GithubProjectsToken,
} from "../github-integration.js";
import type { AppDatabase } from "../../db.js";

const sampleToken: GithubProjectsToken = {
  accessToken: "ghu_test_shared_connect",
  login: "seller",
  connectedAt: "2026-08-15T00:00:00.000Z",
  source: "github_app",
};

function seedCoreUser(userId: string, email: string): void {
  const core = getCloudDb();
  core
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, is_admin)
       VALUES (?, ?, ?, 0)`
    )
    .run(userId, email, email.split("@")[0]);
}

function seedWorkspace(userId: string, tenantId: string, name: string): void {
  const core = getCloudDb();
  core
    .prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, is_operator, owner_user_id)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(tenantId, name, `${name}-${tenantId.slice(0, 8)}`, userId);
  core
    .prepare(
      `INSERT OR IGNORE INTO tenant_memberships (user_id, tenant_id, role) VALUES (?, ?, 'owner')`
    )
    .run(userId, tenantId);
  getTenantDb(tenantId);
}

function plantWorkspaceToken(db: AppDatabase, token: GithubProjectsToken): void {
  db.prepare(
    `DELETE FROM ai_secrets
      WHERE owner_kind = 'user' AND agent_id IS NULL
        AND (id = ? OR name = ?)`
  ).run(GITHUB_PROJECTS_SECRET_ID, GITHUB_PROJECTS_SECRET_NAME);
  db.prepare(
    `INSERT INTO ai_secrets (id, name, value, agent_id, owner_kind) VALUES (?, ?, ?, NULL, 'user')`
  ).run(
    GITHUB_PROJECTS_SECRET_ID,
    GITHUB_PROJECTS_SECRET_NAME,
    encryptSecret(JSON.stringify(token))
  );
}

describe("GitHub Connect across workspaces", () => {
  let tenantIds: string[] = [];
  let userIds: string[] = [];

  beforeEach(() => {
    fs.mkdirSync(usersDir, { recursive: true });
    fs.mkdirSync(tenantsDir, { recursive: true });
    tenantIds = [];
    userIds = [];
  });

  afterEach(() => {
    closeAllUserDbs();
    for (const id of tenantIds) {
      try {
        evictTenantDb(id);
      } catch {
        /* ignore */
      }
    }
    for (const id of userIds) {
      try {
        evictUserDb(id);
      } catch {
        /* ignore */
      }
    }
  });

  function uid(prefix: string): string {
    const id = `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
    userIds.push(id);
    return id;
  }

  function tid(prefix: string): string {
    const id = `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
    tenantIds.push(id);
    return id;
  }

  it("shares Connect from User DB across workspaces for the same account", () => {
    const user1 = uid("user");
    const wsA = tid("ws");
    const wsB = tid("ws");
    seedCoreUser(user1, `${user1}@example.com`);
    seedWorkspace(user1, wsA, "ProjectA");
    seedWorkspace(user1, wsB, "ProjectB");

    upsertGithubProjectsToken(getTenantDb(wsA), sampleToken, user1);

    expect(readGithubProjectsToken(getTenantDb(wsB), user1)?.login).toBe(
      "seller"
    );
    expect(readGithubProjectsToken(getUserDb(user1))?.accessToken).toBe(
      "ghu_test_shared_connect"
    );
    const wsBUserSecrets = getTenantDb(wsB)
      .prepare(
        `SELECT COUNT(*) AS n FROM ai_secrets WHERE owner_kind='user'`
      )
      .get() as { n: number };
    expect(wsBUserSecrets.n).toBe(0);
  });

  it("migrates a leftover workspace Connect token onto the User DB", () => {
    const user1 = uid("user");
    const wsA = tid("ws");
    const wsB = tid("ws");
    seedCoreUser(user1, `${user1}@example.com`);
    seedWorkspace(user1, wsA, "ProjectA");
    seedWorkspace(user1, wsB, "ProjectB");

    plantWorkspaceToken(getTenantDb(wsA), sampleToken);

    expect(migrateGithubConnectToUserVault(user1)?.login).toBe("seller");
    expect(readGithubProjectsToken(getTenantDb(wsB), user1)?.login).toBe(
      "seller"
    );
    expect(
      listSecrets(getTenantDb(wsB), { kind: "user" }, user1).some(
        (s) => s.id === GITHUB_PROJECTS_SECRET_ID
      )
    ).toBe(true);
  });

  it("isolates GitHub Connect between different accounts", () => {
    const user1 = uid("user");
    const user2 = uid("user");
    const wsA = tid("ws");
    const wsOther = tid("ws");
    seedCoreUser(user1, `${user1}@example.com`);
    seedCoreUser(user2, `${user2}@example.com`);
    seedWorkspace(user1, wsA, "ProjectA");
    seedWorkspace(user2, wsOther, "Other");

    upsertGithubProjectsToken(getTenantDb(wsA), sampleToken, user1);
    expect(readGithubProjectsToken(getTenantDb(wsOther), user2)).toBeNull();
    expect(readGithubProjectsToken(getTenantDb(wsA), user1)?.login).toBe(
      "seller"
    );
  });

  it("disconnect clears User DB and leftover workspace copies", () => {
    const user1 = uid("user");
    const wsA = tid("ws");
    const wsB = tid("ws");
    seedCoreUser(user1, `${user1}@example.com`);
    seedWorkspace(user1, wsA, "ProjectA");
    seedWorkspace(user1, wsB, "ProjectB");

    plantWorkspaceToken(getTenantDb(wsA), sampleToken);
    migrateGithubConnectToUserVault(user1);
    clearGithubProjectsToken(getUserDb(user1), user1);

    expect(readGithubProjectsToken(getTenantDb(wsA), user1)).toBeNull();
    expect(readGithubProjectsToken(getTenantDb(wsB), user1)).toBeNull();
    expect(readGithubProjectsToken(getUserDb(user1))).toBeNull();
  });
});
