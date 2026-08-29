/**
 * Chat-safe tenant DB pins (#738): refcount pin vs LRU + live getTenantDb getters.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot, tenantsDir, cloudDbPath } = vi.hoisted(() => {
  const f = require("node:fs") as typeof import("node:fs");
  const o = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const root = f.mkdtempSync(p.join(o.tmpdir(), "gm-tenant-pin-"));
  return {
    tmpRoot: root,
    tenantsDir: p.join(root, "tenants"),
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
      tenantsDir,
      cloudDbPath,
    },
  };
});

import { getCloudDb } from "../../core-db.js";
import {
  closeAllTenantDbs,
  evictTenantDb,
  getTenantDb,
  getTenantDbPinCount,
  pinTenantDb,
  unpinTenantDb,
} from "../../tenant-registry.js";

function seedUser(userId: string): void {
  getCloudDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, is_admin)
       VALUES (?, ?, ?, 0)`
    )
    .run(userId, `${userId}@example.com`, userId);
}

function seedTenant(tenantId: string, ownerUserId: string): void {
  getCloudDb()
    .prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, is_operator, owner_user_id)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(tenantId, tenantId, `${tenantId}-slug`, ownerUserId);
  getTenantDb(tenantId);
}

describe("tenant DB pin / live resolve (#738)", () => {
  const tenantIds: string[] = [];

  beforeEach(() => {
    fs.mkdirSync(tenantsDir, { recursive: true });
    getCloudDb();
  });

  afterEach(() => {
    closeAllTenantDbs();
    for (const id of tenantIds.splice(0)) {
      try {
        evictTenantDb(id);
      } catch {
        /* ignore */
      }
    }
  });

  it("keeps a pinned tenant open when more than MAX_OPEN tenants are opened", () => {
    const owner = "owner-user";
    seedUser(owner);
    const pinnedId = "tenant-pinned";
    tenantIds.push(pinnedId);
    seedTenant(pinnedId, owner);
    const pinnedDb = getTenantDb(pinnedId);
    pinTenantDb(pinnedId);
    expect(getTenantDbPinCount(pinnedId)).toBe(1);

    for (let i = 0; i < 10; i += 1) {
      const id = `tenant-pressure-${i}`;
      tenantIds.push(id);
      seedTenant(id, owner);
    }

    expect(pinnedDb.open).toBe(true);
    expect(
      pinnedDb.prepare(`SELECT 1 AS ok`).get() as { ok: number }
    ).toEqual({ ok: 1 });

    unpinTenantDb(pinnedId);
    expect(getTenantDbPinCount(pinnedId)).toBe(0);
  });

  it("refcount: one unpin leaves protection; second allows eviction", () => {
    const owner = "owner-user";
    seedUser(owner);
    const id = "tenant-refcount";
    tenantIds.push(id);
    seedTenant(id, owner);
    const db = getTenantDb(id);
    pinTenantDb(id);
    pinTenantDb(id);
    expect(getTenantDbPinCount(id)).toBe(2);

    for (let i = 0; i < 10; i += 1) {
      const other = `tenant-other-${i}`;
      tenantIds.push(other);
      seedTenant(other, owner);
    }
    expect(db.open).toBe(true);

    unpinTenantDb(id);
    expect(getTenantDbPinCount(id)).toBe(1);
    expect(db.open).toBe(true);

    unpinTenantDb(id);
    expect(getTenantDbPinCount(id)).toBe(0);
    // Force reclaim by opening more tenants after unpin.
    for (let i = 0; i < 10; i += 1) {
      const other = `tenant-evict-${i}`;
      tenantIds.push(other);
      seedTenant(other, owner);
    }
    expect(db.open).toBe(false);
  });

  it("live getter reopens after forced eviction", () => {
    const owner = "owner-user";
    seedUser(owner);
    const id = "tenant-live";
    tenantIds.push(id);
    seedTenant(id, owner);

    const toolCtx = {
      tenantId: id,
      get db() {
        return getTenantDb(id);
      },
    };

    const first = toolCtx.db;
    expect(first.open).toBe(true);
    first.prepare(`SELECT 1 AS ok`).get();

    evictTenantDb(id);
    expect(first.open).toBe(false);

    const second = toolCtx.db;
    expect(second.open).toBe(true);
    expect(
      second.prepare(`SELECT 1 AS ok`).get() as { ok: number }
    ).toEqual({ ok: 1 });
  });
});
