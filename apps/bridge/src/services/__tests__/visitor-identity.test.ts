/**
 * Public-graph visitors are real users with their own workspace.
 * They are not the install system-local user and not the operator tenant.
 */
import type { Request, Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { tmpRoot, tenantsDir, usersDir, cloudDbPath, dbPath } = vi.hoisted(() => {
  const f = require("node:fs") as typeof import("node:fs");
  const o = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const root = f.mkdtempSync(p.join(o.tmpdir(), "gm-visitor-"));
  return {
    tmpRoot: root,
    tenantsDir: p.join(root, "tenants"),
    usersDir: p.join(root, "users"),
    cloudDbPath: p.join(root, "core.sqlite"),
    dbPath: p.join(root, "missing-legacy.db"),
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
      dbPath,
      auth: { ...actual.config.auth, allowAnonymous: true },
    },
  };
});

import { getCloudDb } from "../../core-db.js";
import { verifyPassword } from "../auth/password.js";
import { requireAuth, resolveTenant } from "../auth/middleware.js";
import { ensurePlatformBootstrap, SYSTEM_USER_ID } from "../tenant-bootstrap.js";
import { evictTenantDb } from "../../tenant-registry.js";
import {
  convertTemporaryVisitor,
  createTemporaryVisitor,
  VisitorIdentityError,
} from "../visitor-identity.js";

function mockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe("visitor identity", () => {
  let operatorTenantId = "";

  beforeAll(() => {
    const boot = ensurePlatformBootstrap();
    operatorTenantId = boot.operatorTenantId;
  });

  afterAll(() => {
    const core = getCloudDb();
    const tenants = core.prepare("SELECT id FROM tenants").all() as Array<{ id: string }>;
    for (const tenant of tenants) evictTenantDb(tenant.id);
  });

  it("does not attach anonymous dev mode to system-local", () => {
    const req = { headers: {}, query: {} } as Request;
    const res = mockRes();
    const next = vi.fn();
    requireAuth(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain("system-local");
  });

  it("gives each visitor a distinct non-operator workspace", () => {
    const core = getCloudDb();
    const a = createTemporaryVisitor(core);
    const b = createTemporaryVisitor(core);

    expect(a.user.id).not.toBe(SYSTEM_USER_ID);
    expect(b.user.id).not.toBe(SYSTEM_USER_ID);
    expect(a.user.id).not.toBe(b.user.id);
    expect(a.user.is_temporary).toBe(1);
    expect(b.user.is_temporary).toBe(1);
    expect(a.tenantId).not.toBe(b.tenantId);
    expect(a.tenantId).not.toBe(operatorTenantId);
    expect(b.tenantId).not.toBe(operatorTenantId);

    const flags = core
      .prepare("SELECT id, is_operator, owner_user_id FROM tenants WHERE id IN (?, ?)")
      .all(a.tenantId, b.tenantId) as Array<{
      id: string;
      is_operator: number;
      owner_user_id: string;
    }>;
    expect(flags).toHaveLength(2);
    for (const row of flags) {
      expect(row.is_operator).toBe(0);
      expect(row.owner_user_id === a.user.id || row.owner_user_id === b.user.id).toBe(
        true
      );
    }

    const req = {
      user: {
        id: a.user.id,
        email: a.user.email,
        displayName: a.user.display_name,
        avatarUrl: null,
        isAdmin: false,
        emailVerified: false,
        mfaEnabled: false,
        temporary: true,
      },
      headers: { "x-tenant-id": operatorTenantId },
      query: {},
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    resolveTenant(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(req.tenantId).toBe(a.tenantId);
    expect(req.tenantIsOperator).toBe(false);
  });

  it("converts signup in place and refuses to merge an existing email", () => {
    const core = getCloudDb();
    const visitor = createTemporaryVisitor(core);
    const other = createTemporaryVisitor(core);
    const beforeTenant = visitor.tenantId;

    const converted = convertTemporaryVisitor(core, visitor.user.id, {
      email: "visitor-convert@example.test",
      password: "secret12",
      displayName: "Converted Visitor",
    });

    expect(converted.id).toBe(visitor.user.id);
    expect(converted.is_temporary).toBe(0);
    expect(converted.email).toBe("visitor-convert@example.test");
    expect(verifyPassword("secret12", converted.password_hash)).toBe(true);

    const membership = core
      .prepare("SELECT tenant_id, role FROM tenant_memberships WHERE user_id=?")
      .all(visitor.user.id) as Array<{ tenant_id: string; role: string }>;
    expect(membership.map((row) => row.tenant_id)).toContain(beforeTenant);
    expect(membership.every((row) => row.tenant_id !== operatorTenantId)).toBe(true);

    expect(() =>
      convertTemporaryVisitor(core, other.user.id, {
        email: "visitor-convert@example.test",
        password: "secret12",
        displayName: "Should Fail",
      })
    ).toThrow(VisitorIdentityError);

    const untouched = core
      .prepare("SELECT id, is_temporary, email FROM users WHERE id=?")
      .get(other.user.id) as { id: string; is_temporary: number; email: string };
    expect(untouched.is_temporary).toBe(1);
    expect(untouched.email).not.toBe("visitor-convert@example.test");
    expect(untouched.id).toBe(other.user.id);
  });
});
