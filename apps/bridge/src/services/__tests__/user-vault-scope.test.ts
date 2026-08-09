/**
 * User Vault on per-account User DB (#491): share Connect keys across workspaces.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot, tenantsDir, usersDir, coreDbPath } = vi.hoisted(() => {
  const f = require("node:fs") as typeof import("node:fs");
  const o = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const root = f.mkdtempSync(p.join(o.tmpdir(), "gm-user-vault-"));
  return {
    tmpRoot: root,
    tenantsDir: p.join(root, "tenants"),
    usersDir: p.join(root, "users"),
    coreDbPath: p.join(root, "core.sqlite"),
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
      coreDbPath,
    },
  };
});

import { getCoreDb } from "../../core-db.js";
import { getTenantDb, evictTenantDb } from "../../tenant-registry.js";
import {
  closeAllUserDbs,
  evictUserDb,
  getUserDb,
} from "../../user-registry.js";
import {
  getPlatformVaultSecretInScope,
  resolvePlatformVaultSecret,
  upsertPlatformVaultSecret,
} from "../agents/agents-db.js";
import {
  OPENAI_API_KEY_SECRET_ID,
  OPENAI_API_KEY_SECRET_NAME,
  resolveOpenAiApiKey,
  upsertOpenAiApiKey,
} from "../openai-platform.js";

function seedCoreUser(userId: string, email: string): void {
  const core = getCoreDb();
  core
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, is_admin)
       VALUES (?, ?, ?, 0)`
    )
    .run(userId, email, email.split("@")[0]);
}

function seedWorkspace(userId: string, tenantId: string, name: string): void {
  const core = getCoreDb();
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

describe("User Vault across workspaces", () => {
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

  it("shares Connect keys across workspaces for the same account", () => {
    const user1 = uid("user");
    const wsA = tid("ws");
    const wsB = tid("ws");
    seedCoreUser(user1, `${user1}@example.com`);
    seedWorkspace(user1, wsA, "ProjectA");
    seedWorkspace(user1, wsB, "ProjectB");

    upsertOpenAiApiKey(getTenantDb(wsA), "sk-shared-account");

    expect(resolveOpenAiApiKey(getTenantDb(wsB))).toBe("sk-shared-account");
    expect(
      getPlatformVaultSecretInScope(getTenantDb(wsB), {
        baseId: OPENAI_API_KEY_SECRET_ID,
        name: OPENAI_API_KEY_SECRET_NAME,
        agentId: null,
      })
    ).toBe("sk-shared-account");

    const userDb = getUserDb(user1);
    expect(
      resolvePlatformVaultSecret(userDb, {
        baseId: OPENAI_API_KEY_SECRET_ID,
        name: OPENAI_API_KEY_SECRET_NAME,
      })
    ).toBe("sk-shared-account");
    const wsBPlatform = getTenantDb(wsB)
      .prepare(
        `SELECT COUNT(*) AS n FROM ai_secrets WHERE owner_kind='platform'`
      )
      .get() as { n: number };
    expect(wsBPlatform.n).toBe(0);
  });

  it("isolates User Vault between different accounts", () => {
    const user1 = uid("user");
    const user2 = uid("user");
    const wsA = tid("ws");
    const wsOther = tid("ws");
    seedCoreUser(user1, `${user1}@example.com`);
    seedCoreUser(user2, `${user2}@example.com`);
    seedWorkspace(user1, wsA, "ProjectA");
    seedWorkspace(user2, wsOther, "Other");

    upsertOpenAiApiKey(getTenantDb(wsA), "sk-user-one");
    expect(resolveOpenAiApiKey(getTenantDb(wsOther))).toBeNull();
    expect(resolveOpenAiApiKey(getTenantDb(wsA))).toBe("sk-user-one");
  });

  it("prefers workspace override over User Vault", () => {
    const user1 = uid("user");
    const wsA = tid("ws");
    const wsB = tid("ws");
    seedCoreUser(user1, `${user1}@example.com`);
    seedWorkspace(user1, wsA, "ProjectA");
    seedWorkspace(user1, wsB, "ProjectB");

    upsertOpenAiApiKey(getTenantDb(wsA), "sk-account");
    upsertPlatformVaultSecret(getTenantDb(wsB), {
      baseId: OPENAI_API_KEY_SECRET_ID,
      name: OPENAI_API_KEY_SECRET_NAME,
      value: "sk-workspace-only",
      workspaceOnly: true,
    });

    expect(resolveOpenAiApiKey(getTenantDb(wsB))).toBe("sk-workspace-only");
    expect(resolveOpenAiApiKey(getTenantDb(wsA))).toBe("sk-account");
  });

  it("lazy-migrates an existing workspace Platform secret into User Vault", () => {
    const user1 = uid("user");
    const wsA = tid("ws");
    const wsB = tid("ws");
    seedCoreUser(user1, `${user1}@example.com`);
    seedWorkspace(user1, wsA, "ProjectA");
    seedWorkspace(user1, wsB, "ProjectB");

    upsertPlatformVaultSecret(getTenantDb(wsA), {
      baseId: OPENAI_API_KEY_SECRET_ID,
      name: OPENAI_API_KEY_SECRET_NAME,
      value: "sk-legacy-ws",
      workspaceOnly: true,
    });

    expect(resolveOpenAiApiKey(getTenantDb(wsB))).toBe("sk-legacy-ws");
  });
});
