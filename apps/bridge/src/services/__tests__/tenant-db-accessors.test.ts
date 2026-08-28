/**
 * SaaS tenant LRU cache (MAX_OPEN=8) must not leave stale closed handles when
 * services scan every tenant at boot (ai-scheduler, reflection, queue worker).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot, tenantsDir, cloudDbPath } = vi.hoisted(() => {
  const f = require("node:fs") as typeof import("node:fs");
  const o = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const root = f.mkdtempSync(p.join(o.tmpdir(), "gm-tenant-accessors-"));
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
  listTenantDbAccessors,
} from "../../tenant-registry.js";
import { listSchedules } from "../ai-scheduler.js";
import type { AppDatabase } from "../../db.js";

function seedUser(userId: string): void {
  const core = getCloudDb();
  core
    .prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, is_admin)
       VALUES (?, ?, ?, 0)`
    )
    .run(userId, `${userId}@example.com`, userId);
}

function seedTenant(tenantId: string, ownerUserId: string): void {
  const core = getCloudDb();
  core
    .prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, is_operator, owner_user_id)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(tenantId, tenantId, `${tenantId}-slug`, ownerUserId);
  getTenantDb(tenantId);
}

describe("listTenantDbAccessors", () => {
  const tenantIds: string[] = [];

  beforeEach(() => {
    fs.mkdirSync(tenantsDir, { recursive: true });
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

  it("keeps tenant DB handles open when more than MAX_OPEN tenants exist", () => {
    const ownerUserId = "owner-user";
    seedUser(ownerUserId);
    for (let i = 0; i < 10; i += 1) {
      const id = `tenant-${i}`;
      tenantIds.push(id);
      seedTenant(id, ownerUserId);
    }

    const fallback = getTenantDb(tenantIds[0]!);
    const allIds = (
      getCloudDb()
        .prepare("SELECT id FROM tenants ORDER BY is_operator DESC, created_at ASC")
        .all() as Array<{ id: string }>
    ).map((r) => r.id);
    expect(allIds.length).toBeGreaterThanOrEqual(10);

    const eager: Array<{ tenantId: string; db: AppDatabase }> = [];
    for (const id of allIds) {
      eager.push({ tenantId: id, db: getTenantDb(id) });
    }
    expect(eager[0]!.db.open).toBe(false);

    const accessors = listTenantDbAccessors(fallback);
    expect(accessors.length).toBe(allIds.length);
    for (const entry of accessors) {
      expect(() => listSchedules(entry.db)).not.toThrow();
      expect(entry.db.open).toBe(true);
    }
  });
});
