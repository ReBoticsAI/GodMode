import type {
  ActionDef,
  ObjectTypeDef,
  RecordData,
  RecordRow,
} from "@godmode/kernel";
import { randomUUID } from "node:crypto";
import type {
  CoreDatabase,
  CoreTenant,
  CoreTenantMembership,
  CoreUser,
  CoreUserProfile,
  MembershipRole,
} from "../../core-db.js";
import {
  createAdminTenantForUser,
  createAdminUser,
  deleteAdminTenant,
  deleteAdminUser,
  getAdminUser,
  listAdminUsers,
  updateAdminTenant,
  updateAdminUser,
  type AdminUserDto,
} from "../../services/admin-users.js";
import { hashPassword, verifyPassword } from "../../services/auth/password.js";
import { refreshUserAgentPrompt } from "../../services/agents/user-agent.js";
import { getUserOwnerTenantDb } from "../../services/user-scope.js";
import {
  promoteFirstSignupAdmin,
  SYSTEM_USER_ID,
} from "../../services/tenant-bootstrap.js";
import type {
  OperationContext,
  RecordAdapter,
  RecordQuery,
} from "../adapter-registry.js";

type TenantLifecycleOperation = "provision" | "deprovision";
type TenantLifecycleStatus = "running" | "succeeded" | "failed";

interface TenantLifecycleRun {
  id: string;
  operation: TenantLifecycleOperation;
  status: TenantLifecycleStatus;
  actor_user_id: string;
  owner_user_id: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_slug: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdentityAdminAdapterServices {
  signup(
    core: CoreDatabase,
    input: { email: string; password: string; displayName?: string }
  ): AdminUserDto;
  createTenant(
    core: CoreDatabase,
    userId: string,
    name: string,
    slug?: string
  ): { id: string; name: string; slug: string };
  deleteTenant(core: CoreDatabase, tenantId: string): void;
  refreshProfile(userId: string): void;
}

const defaultServices: IdentityAdminAdapterServices = {
  signup(core, input) {
    const created = createAdminUser(core, {
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      isAdmin: false,
      provisionDefaultTenant: true,
    });
    promoteFirstSignupAdmin(core, created.id);
    return getAdminUser(core, created.id)!;
  },
  createTenant: createAdminTenantForUser,
  deleteTenant: deleteAdminTenant,
  refreshProfile(userId) {
    try {
      refreshUserAgentPrompt(getUserOwnerTenantDb(userId), userId);
    } catch {
      // A profile can exist before its first workspace is provisioned.
    }
  },
};

let services: IdentityAdminAdapterServices = defaultServices;

export function configureIdentityAdminAdapterServices(
  next: Partial<IdentityAdminAdapterServices>
): void {
  services = { ...defaultServices, ...next };
}

export function resetIdentityAdminAdapterServices(): void {
  services = defaultServices;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function requireUser(ctx: OperationContext): string {
  if (!ctx.userId) throw httpError(401, "Authenticated user required");
  return ctx.userId;
}

function requireAdmin(ctx: OperationContext): void {
  requireUser(ctx);
  if (!ctx.isAdmin && ctx.source !== "system") {
    throw httpError(403, "Platform administrator required");
  }
}

function requireTenantOwner(ctx: OperationContext): string {
  const userId = requireUser(ctx);
  if (!ctx.isAdmin && ctx.role !== "owner") {
    throw httpError(403, "Workspace owner required");
  }
  return userId;
}

function requiredText(data: RecordData, name: string): string {
  const value = data[name];
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, `${name} required`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function page<T>(rows: T[], query: RecordQuery): { rows: T[]; total: number } {
  const offset = Math.max(Number(query.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

function record(def: ObjectTypeDef, id: string, data: RecordData): RecordRow {
  return { id, objectType: def.name, data: { id, ...data } };
}

function userRecord(
  def: ObjectTypeDef,
  user: NonNullable<ReturnType<typeof getAdminUser>>
): RecordRow {
  return record(def, user.id, {
    email: user.email,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    is_admin: user.isAdmin,
    tenant_count: user.tenants.length,
    created_at: user.createdAt,
  });
}

export const userAdminAdapter: RecordAdapter = {
  id: "user_admin_service",
  list(core, def, query, ctx) {
    requireAdmin(ctx);
    const result = page(listAdminUsers(core), query);
    return {
      objectType: def.name,
      records: result.rows.map((user) => userRecord(def, user)),
      total: result.total,
    };
  },
  get(core, def, id, ctx) {
    requireAdmin(ctx);
    const user = getAdminUser(core, id);
    return user ? userRecord(def, user) : null;
  },
  update(core, def, id, data, ctx) {
    requireAdmin(ctx);
    if (data.is_admin === false) {
      const ownsOperator = core
        .prepare(
          `SELECT 1 FROM tenants
           WHERE owner_user_id=? AND is_operator=1`
        )
        .get(id);
      if (ownsOperator) {
        throw httpError(400, "Cannot demote the operator tenant owner");
      }
    }
    const user = updateAdminUser(core, id, {
      email: typeof data.email === "string" ? data.email : undefined,
      displayName:
        typeof data.display_name === "string" ? data.display_name : undefined,
      isAdmin:
        data.is_admin === undefined ? undefined : Boolean(data.is_admin),
      password: typeof data.password === "string" ? data.password : undefined,
    });
    return userRecord(def, user);
  },
  delete(core, _def, id, ctx) {
    requireAdmin(ctx);
    deleteAdminUser(core, id, requireUser(ctx));
  },
  actions: {
    create_account(core, def, _id, input, ctx) {
      requireAdmin(ctx);
      const user = createAdminUser(core, {
        email: requiredText(input, "email"),
        password: requiredText(input, "password"),
        displayName:
          typeof input.display_name === "string"
            ? input.display_name
            : undefined,
        isAdmin: input.is_admin === true,
        // Workspace lifecycle is exposed separately so its run state is durable.
        provisionDefaultTenant: false,
      });
      return userRecord(def, user);
    },
    signup(core, def, _id, input, ctx) {
      if (ctx.source !== "system") {
        throw httpError(403, "Signup requires the trusted authentication transport");
      }
      const created = services.signup(core, {
        email: requiredText(input, "email"),
        password: requiredText(input, "password"),
        displayName:
          typeof input.display_name === "string"
            ? input.display_name
            : undefined,
      });
      return userRecord(def, created);
    },
    reset_password(core, def, id, input, ctx) {
      requireAdmin(ctx);
      const user = updateAdminUser(core, id, {
        password: requiredText(input, "new_password"),
      });
      return userRecord(def, user);
    },
  },
};

const PROFILE_COLUMNS = [
  "headline",
  "bio",
  "pronouns",
  "location",
  "timezone",
  "phone",
  "company",
  "job_title",
  "website",
  "twitter",
  "github",
  "linkedin",
  "emoji",
  "birthday",
  "languages",
  "interests",
  "values",
  "goals",
  "personality_notes",
  "decision_style",
  "risk_tolerance",
] as const;

function profileRecord(
  core: CoreDatabase,
  def: ObjectTypeDef,
  userId: string
): RecordRow | null {
  const user = core
    .prepare(
      `SELECT id, email, display_name, avatar_url, created_at, updated_at
       FROM users WHERE id=? AND id<>?`
    )
    .get(userId, SYSTEM_USER_ID) as
    | Pick<
        CoreUser,
        "id" | "email" | "display_name" | "avatar_url" | "created_at" | "updated_at"
      >
    | undefined;
  if (!user) return null;
  const profile = core
    .prepare(`SELECT * FROM user_profiles WHERE user_id=?`)
    .get(userId) as CoreUserProfile | undefined;
  const data: RecordData = {
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    created_at: profile?.created_at ?? user.created_at,
    updated_at: profile?.updated_at ?? user.updated_at,
  };
  for (const column of PROFILE_COLUMNS) data[column] = profile?.[column] ?? null;
  return record(def, user.id, data);
}

function assertSelfOrAdmin(id: string, ctx: OperationContext): string {
  const userId = requireUser(ctx);
  if (id !== userId && !ctx.isAdmin) throw httpError(404, "Profile not found");
  if (id === SYSTEM_USER_ID) throw httpError(404, "Profile not found");
  return userId;
}

function updateProfile(
  core: CoreDatabase,
  def: ObjectTypeDef,
  userId: string,
  data: RecordData
): RecordRow {
  const existing = profileRecord(core, def, userId);
  if (!existing) throw httpError(404, "Profile not found");
  core.transaction(() => {
    if (data.display_name !== undefined) {
      const displayName = requiredText(data, "display_name");
      core
        .prepare(
          `UPDATE users SET display_name=?, updated_at=datetime('now') WHERE id=?`
        )
        .run(displayName, userId);
    }
    if (data.avatar_url !== undefined) {
      core
        .prepare(
          `UPDATE users SET avatar_url=?, updated_at=datetime('now') WHERE id=?`
        )
        .run(optionalText(data.avatar_url), userId);
    }
    core
      .prepare(
        `INSERT INTO user_profiles (user_id) VALUES (?)
         ON CONFLICT(user_id) DO NOTHING`
      )
      .run(userId);
    const sets: string[] = [];
    const values: Array<string | null> = [];
    for (const column of PROFILE_COLUMNS) {
      if (data[column] !== undefined) {
        sets.push(`"${column}"=?`);
        values.push(optionalText(data[column]) ?? null);
      }
    }
    if (sets.length) {
      core
        .prepare(
          `UPDATE user_profiles
           SET ${sets.join(", ")}, updated_at=datetime('now')
           WHERE user_id=?`
        )
        .run(...values, userId);
    }
  })();
  services.refreshProfile(userId);
  return profileRecord(core, def, userId)!;
}

export const userProfileAdapter: RecordAdapter = {
  id: "user_profile_service",
  list(core, def, query, ctx) {
    const userId = requireUser(ctx);
    const ids = ctx.isAdmin
      ? (
          core
            .prepare(`SELECT id FROM users WHERE id<>? ORDER BY created_at`)
            .all(SYSTEM_USER_ID) as Array<{ id: string }>
        ).map((row) => row.id)
      : [userId];
    const rows = ids
      .map((id) => profileRecord(core, def, id))
      .filter((row): row is RecordRow => Boolean(row));
    const result = page(rows, query);
    return { objectType: def.name, records: result.rows, total: result.total };
  },
  get(core, def, id, ctx) {
    const userId = requireUser(ctx);
    if ((id !== userId && !ctx.isAdmin) || id === SYSTEM_USER_ID) return null;
    return profileRecord(core, def, id);
  },
  update(core, def, id, data, ctx) {
    assertSelfOrAdmin(id, ctx);
    return updateProfile(core, def, id, data);
  },
  actions: {
    update_profile(core, def, id, input, ctx) {
      assertSelfOrAdmin(id, ctx);
      return updateProfile(core, def, id, input);
    },
  },
};

function credentialRecord(
  core: CoreDatabase,
  def: ObjectTypeDef,
  userId: string
): RecordRow | null {
  const row = core
    .prepare(
      `SELECT u.id, u.password_hash, u.updated_at,
              EXISTS(SELECT 1 FROM oauth_accounts o WHERE o.user_id=u.id) AS has_oauth
       FROM users u WHERE u.id=? AND u.id<>?`
    )
    .get(userId, SYSTEM_USER_ID) as
    | {
        id: string;
        password_hash: string | null;
        updated_at: string;
        has_oauth: number;
      }
    | undefined;
  return row
    ? record(def, row.id, {
        user_id: row.id,
        has_password: Boolean(row.password_hash),
        has_oauth: Boolean(row.has_oauth),
        updated_at: row.updated_at,
      })
    : null;
}

function setPassword(
  core: CoreDatabase,
  def: ObjectTypeDef,
  id: string,
  input: RecordData,
  ctx: OperationContext
): RecordRow {
  assertSelfOrAdmin(id, ctx);
  const row = core
    .prepare(`SELECT password_hash FROM users WHERE id=? AND id<>?`)
    .get(id, SYSTEM_USER_ID) as { password_hash: string | null } | undefined;
  if (!row) throw httpError(404, "Credential not found");
  const next = requiredText(input, "new_password");
  if (next.length < 6) throw httpError(400, "new_password must be at least 6 characters");
  if (!ctx.isAdmin) {
    const current = requiredText(input, "current_password");
    if (!verifyPassword(current, row.password_hash)) {
      throw httpError(401, "Current password is incorrect");
    }
  }
  core
    .prepare(
      `UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(hashPassword(next), id);
  return credentialRecord(core, def, id)!;
}

export const userCredentialAdapter: RecordAdapter = {
  id: "user_credential_service",
  list(core, def, query, ctx) {
    const id = requireUser(ctx);
    const row = credentialRecord(core, def, id);
    const result = page(row ? [row] : [], query);
    return { objectType: def.name, records: result.rows, total: result.total };
  },
  get(core, def, id, ctx) {
    const userId = requireUser(ctx);
    if ((id !== userId && !ctx.isAdmin) || id === SYSTEM_USER_ID) return null;
    return credentialRecord(core, def, id);
  },
  actions: {
    change_password(core, def, id, input, ctx) {
      return setPassword(core, def, id, input, ctx);
    },
    reset_password(core, def, id, input, ctx) {
      requireAdmin(ctx);
      return setPassword(core, def, id, input, ctx);
    },
  },
};

function tenantRecord(def: ObjectTypeDef, row: CoreTenant): RecordRow {
  return record(def, row.id, {
    name: row.name,
    slug: row.slug,
    is_operator: Boolean(row.is_operator),
    owner_user_id: row.owner_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function visibleTenants(
  core: CoreDatabase,
  ctx: OperationContext
): CoreTenant[] {
  const userId = requireUser(ctx);
  if (ctx.isAdmin) {
    return core.prepare(`SELECT * FROM tenants ORDER BY is_operator DESC, name`).all() as CoreTenant[];
  }
  return core
    .prepare(
      `SELECT t.* FROM tenants t
       JOIN tenant_memberships m ON m.tenant_id=t.id
       WHERE m.user_id=? AND (? IS NULL OR t.id=?)
       ORDER BY t.name`
    )
    .all(userId, ctx.tenantId ?? null, ctx.tenantId ?? null) as CoreTenant[];
}

const RUN_PREFIX = "kernel.tenant_lifecycle.";

function now(): string {
  return new Date().toISOString();
}

function saveRun(core: CoreDatabase, run: TenantLifecycleRun): void {
  core
    .prepare(
      `INSERT INTO platform_meta (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE
       SET value=excluded.value, updated_at=datetime('now')`
    )
    .run(`${RUN_PREFIX}${run.id}`, JSON.stringify(run));
}

function listRuns(core: CoreDatabase): TenantLifecycleRun[] {
  const rows = core
    .prepare(
      `SELECT value FROM platform_meta WHERE key LIKE ?
       ORDER BY rowid DESC`
    )
    .all(`${RUN_PREFIX}%`) as Array<{ value: string }>;
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.value) as TenantLifecycleRun];
    } catch {
      return [];
    }
  });
}

function lifecycleRecord(
  def: ObjectTypeDef,
  run: TenantLifecycleRun
): RecordRow {
  return record(def, run.id, run as unknown as RecordData);
}

function startLifecycleRun(
  core: CoreDatabase,
  input: Omit<
    TenantLifecycleRun,
    "id" | "status" | "error" | "created_at" | "updated_at"
  >
): TenantLifecycleRun {
  const timestamp = now();
  const run: TenantLifecycleRun = {
    ...input,
    id: randomUUID(),
    status: "running",
    error: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  saveRun(core, run);
  return run;
}

function finishRun(
  core: CoreDatabase,
  run: TenantLifecycleRun,
  status: Extract<TenantLifecycleStatus, "succeeded" | "failed">,
  patch: Partial<TenantLifecycleRun> = {}
): TenantLifecycleRun {
  Object.assign(run, patch, { status, updated_at: now() });
  saveRun(core, run);
  return run;
}

function provisionTenant(
  core: CoreDatabase,
  data: RecordData,
  ctx: OperationContext
): CoreTenant {
  const actorId = requireTenantOwner(ctx);
  const ownerId =
    typeof data.owner_user_id === "string" ? data.owner_user_id : actorId;
  if (ownerId !== actorId && !ctx.isAdmin) {
    throw httpError(403, "Only administrators can provision for another user");
  }
  const name = requiredText(data, "name");
  const slug = typeof data.slug === "string" ? data.slug : undefined;
  const run = startLifecycleRun(core, {
    operation: "provision",
    actor_user_id: actorId,
    owner_user_id: ownerId,
    tenant_id: null,
    tenant_name: name,
    tenant_slug: slug ?? null,
  });
  try {
    const created = services.createTenant(core, ownerId, name, slug);
    const tenant = core
      .prepare(`SELECT * FROM tenants WHERE id=?`)
      .get(created.id) as CoreTenant | undefined;
    if (!tenant) throw new Error("Tenant service returned no durable tenant row");
    finishRun(core, run, "succeeded", {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
    });
    return tenant;
  } catch (error) {
    finishRun(core, run, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function deprovisionTenant(
  core: CoreDatabase,
  tenantId: string,
  ctx: OperationContext
): void {
  requireAdmin(ctx);
  const tenant = core
    .prepare(`SELECT * FROM tenants WHERE id=?`)
    .get(tenantId) as CoreTenant | undefined;
  if (!tenant) throw httpError(404, "Tenant not found");
  if (tenant.is_operator) throw httpError(400, "Cannot delete the operator tenant");
  const run = startLifecycleRun(core, {
    operation: "deprovision",
    actor_user_id: requireUser(ctx),
    owner_user_id: tenant.owner_user_id,
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    tenant_slug: tenant.slug,
  });
  try {
    services.deleteTenant(core, tenantId);
    finishRun(core, run, "succeeded");
  } catch (error) {
    finishRun(core, run, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const tenantAdminAdapter: RecordAdapter = {
  id: "tenant_admin_service",
  list(core, def, query, ctx) {
    const result = page(visibleTenants(core, ctx), query);
    return {
      objectType: def.name,
      records: result.rows.map((tenant) => tenantRecord(def, tenant)),
      total: result.total,
    };
  },
  get(core, def, id, ctx) {
    const tenant = visibleTenants(core, ctx).find((row) => row.id === id);
    return tenant ? tenantRecord(def, tenant) : null;
  },
  create(core, def, data, ctx) {
    return tenantRecord(def, provisionTenant(core, data, ctx));
  },
  update(core, def, id, data, ctx) {
    requireTenantOwner(ctx);
    const tenant = visibleTenants(core, ctx).find((row) => row.id === id);
    if (!tenant) throw httpError(404, "Tenant not found");
    if (tenant.is_operator && !ctx.isAdmin) {
      throw httpError(403, "Operator tenant changes require an administrator");
    }
    const updated = updateAdminTenant(core, id, {
      name: typeof data.name === "string" ? data.name : undefined,
      slug: typeof data.slug === "string" ? data.slug : undefined,
    });
    return tenantRecord(def, {
      ...tenant,
      name: updated.name,
      slug: updated.slug,
    });
  },
  delete(core, _def, id, ctx) {
    deprovisionTenant(core, id, ctx);
  },
  actions: {
    provision(core, def, _id, input, ctx) {
      return tenantRecord(def, provisionTenant(core, input, ctx));
    },
    deprovision(core, _def, id, _input, ctx) {
      deprovisionTenant(core, id, ctx);
      return { ok: true };
    },
  },
};

function membershipId(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

function membershipRecord(
  def: ObjectTypeDef,
  row: CoreTenantMembership
): RecordRow {
  return record(def, membershipId(row.tenant_id, row.user_id), {
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    role: row.role,
    created_at: row.created_at,
  });
}

function targetTenant(data: RecordData, ctx: OperationContext): string {
  const tenantId =
    typeof data.tenant_id === "string" ? data.tenant_id : ctx.tenantId;
  if (!tenantId) throw httpError(400, "tenant_id required");
  if (!ctx.isAdmin && tenantId !== ctx.tenantId) {
    throw httpError(404, "Membership not found");
  }
  return tenantId;
}

function parseMembershipRole(value: unknown): MembershipRole {
  if (value !== "viewer" && value !== "editor" && value !== "owner") {
    throw httpError(400, "role must be viewer, editor, or owner");
  }
  return value;
}

function getMembership(
  core: CoreDatabase,
  id: string
): CoreTenantMembership | undefined {
  const separator = id.indexOf(":");
  if (separator < 1) return undefined;
  return core
    .prepare(
      `SELECT * FROM tenant_memberships WHERE tenant_id=? AND user_id=?`
    )
    .get(id.slice(0, separator), id.slice(separator + 1)) as
    | CoreTenantMembership
    | undefined;
}

function protectMembershipMutation(
  core: CoreDatabase,
  row: CoreTenantMembership,
  nextRole?: MembershipRole
): void {
  if (row.user_id === SYSTEM_USER_ID) {
    throw httpError(400, "Cannot modify the system identity");
  }
  const tenant = core
    .prepare(`SELECT is_operator, owner_user_id FROM tenants WHERE id=?`)
    .get(row.tenant_id) as
    | { is_operator: number; owner_user_id: string }
    | undefined;
  if (!tenant) throw httpError(404, "Tenant not found");
  if (tenant.is_operator && row.user_id === tenant.owner_user_id) {
    throw httpError(400, "Cannot modify the operator tenant owner");
  }
  if (row.role === "owner" && nextRole !== "owner") {
    const owners = (
      core
        .prepare(
          `SELECT COUNT(*) AS count FROM tenant_memberships
           WHERE tenant_id=? AND role='owner'`
        )
        .get(row.tenant_id) as { count: number }
    ).count;
    if (owners <= 1) throw httpError(400, "Cannot remove the last workspace owner");
  }
}

export const tenantMembershipAdapter: RecordAdapter = {
  id: "tenant_membership_service",
  list(core, def, query, ctx) {
    requireUser(ctx);
    const tenantId = targetTenant(query.filters ?? {}, ctx);
    const rows = core
      .prepare(
        `SELECT * FROM tenant_memberships WHERE tenant_id=?
         ORDER BY role DESC, created_at`
      )
      .all(tenantId) as CoreTenantMembership[];
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((row) => membershipRecord(def, row)),
      total: result.total,
    };
  },
  get(core, def, id, ctx) {
    requireUser(ctx);
    const row = getMembership(core, id);
    if (!row || (!ctx.isAdmin && row.tenant_id !== ctx.tenantId)) return null;
    return membershipRecord(def, row);
  },
  create(core, def, data, ctx) {
    requireTenantOwner(ctx);
    const tenantId = targetTenant(data, ctx);
    const userId = requiredText(data, "user_id");
    if (userId === SYSTEM_USER_ID) throw httpError(400, "Cannot add the system identity");
    const user = core.prepare(`SELECT id FROM users WHERE id=?`).get(userId);
    if (!user) throw httpError(404, "User not found");
    const role = parseMembershipRole(data.role ?? "viewer");
    try {
      core
        .prepare(
          `INSERT INTO tenant_memberships (user_id, tenant_id, role)
           VALUES (?, ?, ?)`
        )
        .run(userId, tenantId, role);
    } catch {
      throw httpError(409, "Membership already exists");
    }
    return membershipRecord(def, getMembership(core, membershipId(tenantId, userId))!);
  },
  update(core, def, id, data, ctx) {
    requireTenantOwner(ctx);
    const row = getMembership(core, id);
    if (!row || (!ctx.isAdmin && row.tenant_id !== ctx.tenantId)) {
      throw httpError(404, "Membership not found");
    }
    const role = parseMembershipRole(data.role);
    protectMembershipMutation(core, row, role);
    core
      .prepare(`UPDATE tenant_memberships SET role=? WHERE user_id=? AND tenant_id=?`)
      .run(role, row.user_id, row.tenant_id);
    return membershipRecord(def, { ...row, role });
  },
  delete(core, _def, id, ctx) {
    requireTenantOwner(ctx);
    const row = getMembership(core, id);
    if (!row || (!ctx.isAdmin && row.tenant_id !== ctx.tenantId)) {
      throw httpError(404, "Membership not found");
    }
    protectMembershipMutation(core, row);
    core
      .prepare(`DELETE FROM tenant_memberships WHERE user_id=? AND tenant_id=?`)
      .run(row.user_id, row.tenant_id);
  },
  actions: {
    set_role(core, def, id, input, ctx) {
      return tenantMembershipAdapter.update!(core, def, id, input, ctx);
    },
    remove(core, def, id, _input, ctx) {
      tenantMembershipAdapter.delete!(core, def, id, ctx);
      return { ok: true };
    },
  },
};

export const tenantProvisioningRunAdapter: RecordAdapter = {
  id: "tenant_provisioning_run_service",
  list(core, def, query, ctx) {
    const actorId = requireUser(ctx);
    const rows = listRuns(core).filter(
      (run) => ctx.isAdmin || run.actor_user_id === actorId
    );
    const result = page(rows, query);
    return {
      objectType: def.name,
      records: result.rows.map((run) => lifecycleRecord(def, run)),
      total: result.total,
    };
  },
  get(core, def, id, ctx) {
    const actorId = requireUser(ctx);
    const run = listRuns(core).find((candidate) => candidate.id === id);
    return run && (ctx.isAdmin || run.actor_user_id === actorId)
      ? lifecycleRecord(def, run)
      : null;
  },
};

const writeRoles: ActionDef["roles"] = ["editor", "owner", "intelligence"];
const schema = (
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});
const action = (
  name: string,
  options: Partial<ActionDef> = {}
): ActionDef => ({
  name,
  label: name
    .split("_")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" "),
  target: "record",
  effect: "write",
  execution: "sync",
  roles: writeRoles,
  inputSchema: schema({}),
  ...options,
});

export const IDENTITY_ADMIN_ACTIONS: Record<string, ActionDef[]> = {
  User: [
    action("create_account", {
      target: "collection",
      confirmation: { required: true },
      idempotency: { required: true },
      sensitiveInputPaths: ["password"],
      inputSchema: schema(
        {
          email: { type: "string" },
          password: { type: "string", minLength: 6 },
          display_name: { type: "string" },
          is_admin: { type: "boolean" },
        },
        ["email", "password"]
      ),
    }),
    action("signup", {
      target: "collection",
      sensitiveInputPaths: ["password"],
      inputSchema: schema(
        {
          email: { type: "string" },
          password: { type: "string", minLength: 6 },
          display_name: { type: "string" },
        },
        ["email", "password"]
      ),
    }),
    action("reset_password", {
      confirmation: { required: true },
      sensitiveInputPaths: ["new_password"],
      inputSchema: schema(
        { new_password: { type: "string", minLength: 6 } },
        ["new_password"]
      ),
    }),
  ],
  UserProfile: [
    action("update_profile", {
      inputSchema: schema(
        Object.fromEntries(
          ["display_name", "avatar_url", ...PROFILE_COLUMNS].map((name) => [
            name,
            { type: ["string", "null"] },
          ])
        )
      ),
    }),
  ],
  UserCredential: [
    action("change_password", {
      sensitiveInputPaths: ["current_password", "new_password"],
      inputSchema: schema(
        {
          current_password: { type: "string", minLength: 1 },
          new_password: { type: "string", minLength: 6 },
        },
        ["new_password"]
      ),
    }),
    action("reset_password", {
      roles: ["owner", "intelligence"],
      confirmation: { required: true },
      sensitiveInputPaths: ["new_password"],
      inputSchema: schema(
        { new_password: { type: "string", minLength: 6 } },
        ["new_password"]
      ),
    }),
  ],
  Tenant: [
    action("provision", {
      target: "collection",
      confirmation: { required: true },
      idempotency: { required: true },
      inputSchema: schema(
        {
          owner_user_id: { type: "string" },
          name: { type: "string" },
          slug: { type: "string" },
        },
        ["name"]
      ),
    }),
    action("deprovision", {
      effect: "destructive",
      confirmation: { required: true },
      idempotency: { required: true },
    }),
  ],
  TenantMembership: [
    action("set_role", {
      confirmation: { required: true },
      inputSchema: schema(
        { role: { enum: ["viewer", "editor", "owner"] } },
        ["role"]
      ),
    }),
    action("remove", {
      effect: "destructive",
      confirmation: { required: true },
    }),
  ],
};

export const identityAdminAdapters = [
  userAdminAdapter,
  userProfileAdapter,
  userCredentialAdapter,
  tenantAdminAdapter,
  tenantMembershipAdapter,
  tenantProvisioningRunAdapter,
] as const;
