import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase, MarketplaceListingKind, ShareGrantRole } from "../core-db.js";
import { getLocalConnection } from "./bridge-connections.js";
import { config } from "../config.js";
import { getTenantDb } from "../tenant-registry.js";
import type { AppDatabase } from "../db.js";
import { emitEvent } from "./event-bus.js";

const ROLE_RANK: Record<ShareGrantRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export class ShareError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createShareGrant(
  core: CoreDatabase,
  opts: {
    ownerTenantId: string;
    ownerUserId: string;
    resourceKind: MarketplaceListingKind;
    resourceId: string;
    granteeUserId?: string;
    granteeTenantId?: string;
    role?: ShareGrantRole;
    /** Federation peer URL the grantee's Bridge proxies SC operations to. */
    bridgeUrl?: string | null;
    /** Federation token the grantee presents to the owner's Bridge. */
    federationToken?: string | null;
  }
): string {
  if (!opts.granteeUserId && !opts.granteeTenantId) {
    throw new ShareError(400, "grantee user or tenant required");
  }
  const id = uuidv4();
  const bridgeUrl = opts.bridgeUrl ?? config.auth.publicUrl;
  const federationToken = opts.federationToken ?? uuidv4();
  void getLocalConnection(core, opts.ownerTenantId);
  core.prepare(
    `INSERT INTO share_grants
       (id, owner_tenant_id, owner_user_id, resource_kind, resource_id,
        grantee_user_id, grantee_tenant_id, role, bridge_url, federation_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.ownerTenantId,
    opts.ownerUserId,
    opts.resourceKind,
    opts.resourceId,
    opts.granteeUserId ?? null,
    opts.granteeTenantId ?? null,
    opts.role ?? "viewer",
    bridgeUrl,
    federationToken
  );
  emitEvent(
    {
      type: "share.created",
      actor: { kind: "user", id: opts.ownerUserId },
      tenantId: opts.ownerTenantId,
      payload: {
        shareGrantId: id,
        resourceKind: opts.resourceKind,
        resourceId: opts.resourceId,
        granteeUserId: opts.granteeUserId ?? null,
        granteeTenantId: opts.granteeTenantId ?? null,
      },
    },
    core
  );
  return id;
}

export function listShareGrantsForUser(
  core: CoreDatabase,
  userId: string
): Array<Record<string, unknown>> {
  return core
    .prepare(
      `SELECT DISTINCT g.*
       FROM share_grants g
       LEFT JOIN tenant_memberships m
         ON m.tenant_id = g.grantee_tenant_id AND m.user_id = ?
       WHERE g.grantee_user_id = ?
          OR g.owner_user_id = ?
          OR m.user_id IS NOT NULL
       ORDER BY g.created_at DESC`
    )
    .all(userId, userId, userId) as Array<Record<string, unknown>>;
}

export function listShareGrantsForResource(
  core: CoreDatabase,
  ownerTenantId: string,
  resourceKind: string,
  resourceId: string
): Array<Record<string, unknown>> {
  return core
    .prepare(
      `SELECT * FROM share_grants
       WHERE owner_tenant_id=? AND resource_kind=? AND resource_id=?`
    )
    .all(ownerTenantId, resourceKind, resourceId) as Array<Record<string, unknown>>;
}

export function revokeShareGrant(core: CoreDatabase, grantId: string, ownerUserId: string): void {
  const row = core
    .prepare("SELECT owner_user_id FROM share_grants WHERE id=?")
    .get(grantId) as { owner_user_id: string } | undefined;
  if (!row) throw new ShareError(404, "Grant not found");
  if (row.owner_user_id !== ownerUserId) throw new ShareError(403, "Not grant owner");
  core.prepare("DELETE FROM share_grants WHERE id=?").run(grantId);
}

export function resolveShareAccess(
  core: CoreDatabase,
  opts: {
    userId: string;
    tenantId: string;
    resourceKind: MarketplaceListingKind;
    resourceId: string;
    minRole?: ShareGrantRole;
  }
): { ownerTenantId: string; role: ShareGrantRole; db: AppDatabase } | null {
  const grants = core
    .prepare(
      `SELECT * FROM share_grants
       WHERE resource_kind=? AND resource_id=?
         AND (grantee_user_id=? OR grantee_tenant_id=?)`
    )
    .all(opts.resourceKind, opts.resourceId, opts.userId, opts.tenantId) as Array<{
    owner_tenant_id: string;
    role: ShareGrantRole;
  }>;

  if (grants.length === 0) return null;

  const best = grants.reduce((a, b) =>
    ROLE_RANK[b.role] > ROLE_RANK[a.role] ? b : a
  );

  if (opts.minRole && ROLE_RANK[best.role] < ROLE_RANK[opts.minRole]) {
    return null;
  }

  return {
    ownerTenantId: best.owner_tenant_id,
    role: best.role,
    db: getTenantDb(best.owner_tenant_id),
  };
}

/**
 * True when a `model` share_grant for `endpointId` grants the user access
 * (directly by user id, or via membership in the grantee tenant). Used by
 * `runRemoteInference` to allow FREE friend-to-friend inference.
 */
export function hasModelShareAccess(
  core: CoreDatabase,
  opts: { userId: string; tenantId: string; endpointId: string }
): boolean {
  const row = core
    .prepare(
      `SELECT 1
       FROM share_grants g
       LEFT JOIN tenant_memberships m
         ON m.tenant_id = g.grantee_tenant_id AND m.user_id = ?
       WHERE g.resource_kind='model' AND g.resource_id=?
         AND (
           g.grantee_user_id = ?
           OR g.grantee_tenant_id = ?
           OR (g.grantee_user_id IS NULL AND m.user_id IS NOT NULL)
         )
       LIMIT 1`
    )
    .get(opts.userId, opts.endpointId, opts.userId, opts.tenantId);
  return !!row;
}

export interface SharedModel {
  grantId: string;
  endpointId: string;
  name: string;
  ownerUserId: string;
  ownerDisplayName: string;
  baseModelName: string;
}

/**
 * Models shared *with* the user (incoming `model` grants), resolved to the
 * endpoint's name + a friendly base-model filename + the owner's display name.
 */
export function listSharedModelsForUser(
  core: CoreDatabase,
  userId: string
): SharedModel[] {
  const grants = listIncomingShareGrants(core, userId).filter(
    (g) => String(g.resource_kind) === "model"
  );
  const seen = new Set<string>();
  const out: SharedModel[] = [];
  for (const g of grants) {
    const endpointId = String(g.resource_id ?? "");
    if (!endpointId || seen.has(endpointId)) continue;
    const ep = core
      .prepare(
        `SELECT id, name, base_model_path FROM inference_endpoints
         WHERE id=? AND status='active'`
      )
      .get(endpointId) as
      | { id: string; name: string; base_model_path: string }
      | undefined;
    if (!ep) continue;
    seen.add(endpointId);
    const baseModelName = String(ep.base_model_path)
      .split(/[\\/]/)
      .pop()!
      .replace(/\.gguf$/i, "");
    out.push({
      grantId: String(g.id ?? ""),
      endpointId: ep.id,
      name: ep.name,
      ownerUserId: String(g.owner_user_id ?? ""),
      ownerDisplayName:
        String(g.owner_display_name ?? "").trim() ||
        String(g.owner_user_id ?? "").slice(0, 8),
      baseModelName,
    });
  }
  return out;
}

export function assertShareRole(
  role: ShareGrantRole | undefined,
  minRole: ShareGrantRole
): void {
  if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw new ShareError(403, `Requires ${minRole} role on shared resource`);
  }
}

export interface SharedSidebarDivision {
  grantId: string;
  id: string;
  label: string;
  basePath: string;
  resourceKind: string;
  resourceId: string;
}

export interface SharedSidebarDepartment {
  id: string;
  label: string;
  basePath: string;
  divisions: SharedSidebarDivision[];
}

export interface SharedSidebarOwner {
  ownerUserId: string;
  ownerDisplayName: string;
  departments: SharedSidebarDepartment[];
}

/** Grants shared *with* the user (incoming), excluding self-owned grants. */
export function listIncomingShareGrants(
  core: CoreDatabase,
  userId: string
): Array<Record<string, unknown>> {
  return core
    .prepare(
      `SELECT DISTINCT g.*, u.display_name AS owner_display_name
       FROM share_grants g
       JOIN users u ON u.id = g.owner_user_id
       LEFT JOIN tenant_memberships m
         ON m.tenant_id = g.grantee_tenant_id AND m.user_id = ?
       WHERE g.owner_user_id != ?
         AND (
           g.grantee_user_id = ?
           OR (g.grantee_user_id IS NULL AND m.user_id IS NOT NULL)
         )
       ORDER BY u.display_name, g.resource_kind, g.resource_id`
    )
    .all(userId, userId, userId) as Array<Record<string, unknown>>;
}

/**
 * Build owner → department → division tree for the Shared sidebar from
 * incoming department/division grants, resolving labels from the owner's tenant.
 */
export function buildSharedSidebarTree(
  core: CoreDatabase,
  userId: string
): SharedSidebarOwner[] {
  const grants = listIncomingShareGrants(core, userId);
  const owners = new Map<string, SharedSidebarOwner>();

  const ensureOwner = (
    ownerUserId: string,
    ownerDisplayName: string
  ): SharedSidebarOwner => {
    const existing = owners.get(ownerUserId);
    if (existing) return existing;
    const node: SharedSidebarOwner = {
      ownerUserId,
      ownerDisplayName,
      departments: [],
    };
    owners.set(ownerUserId, node);
    return node;
  };

  const ensureDept = (
    owner: SharedSidebarOwner,
    deptId: string,
    label: string,
    basePath: string
  ): SharedSidebarDepartment => {
    let dept = owner.departments.find((d) => d.id === deptId);
    if (!dept) {
      dept = { id: deptId, label, basePath, divisions: [] };
      owner.departments.push(dept);
    }
    return dept;
  };

  for (const g of grants) {
    const kind = String(g.resource_kind ?? "");
    const resourceId = String(g.resource_id ?? "");
    const grantId = String(g.id ?? "");
    const ownerUserId = String(g.owner_user_id ?? "");
    const ownerDisplayName =
      String(g.owner_display_name ?? "").trim() ||
      ownerUserId.slice(0, 8);
    const ownerTenantId = String(g.owner_tenant_id ?? "");
    if (!ownerTenantId || !ownerUserId) continue;

    let ownerDb: AppDatabase;
    try {
      ownerDb = getTenantDb(ownerTenantId);
    } catch {
      continue;
    }

    const owner = ensureOwner(ownerUserId, ownerDisplayName);

    // Resolve labels/paths from the owner's canonical `structure_nodes` tree.
    // Department = top-level node (parent_id IS NULL, id = `<deptId>`).
    // Division = its direct child whose segment = `<divId>`; the canonical
    // division resourceId is `<deptId>/<divSegment>` (e.g. `trading/sierra`).
    if (kind === "division" && resourceId.includes("/")) {
      const [deptId, divId] = resourceId.split("/", 2);
      const deptRow = ownerDb
        .prepare(
          `SELECT id, label, segment FROM structure_nodes
           WHERE id=? AND parent_id IS NULL LIMIT 1`
        )
        .get(deptId) as
        | { id: string; label: string; segment: string }
        | undefined;
      const divRow = ownerDb
        .prepare(
          `SELECT id, label, segment FROM structure_nodes
           WHERE parent_id=? AND segment=? LIMIT 1`
        )
        .get(deptId, divId) as
        | { id: string; label: string; segment: string }
        | undefined;
      if (!divRow) continue;

      const deptSegment = deptRow?.segment ?? deptId;
      const dept = ensureDept(
        owner,
        deptId,
        deptRow?.label ?? deptId,
        `/${deptSegment}`
      );
      if (!dept.divisions.some((d) => d.grantId === grantId)) {
        dept.divisions.push({
          grantId,
          id: divId,
          label: divRow.label,
          basePath: `/${deptSegment}/${divRow.segment}`,
          resourceKind: kind,
          resourceId,
        });
      }
    } else if (kind === "department") {
      const deptRow = ownerDb
        .prepare(
          `SELECT id, label, segment FROM structure_nodes
           WHERE id=? AND parent_id IS NULL LIMIT 1`
        )
        .get(resourceId) as
        | { id: string; label: string; segment: string }
        | undefined;
      if (deptRow) {
        ensureDept(owner, deptRow.id, deptRow.label, `/${deptRow.segment}`);
      }
    }
  }

  for (const owner of owners.values()) {
    owner.departments.sort((a, b) => a.label.localeCompare(b.label));
    for (const dept of owner.departments) {
      dept.divisions.sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  return [...owners.values()].sort((a, b) =>
    a.ownerDisplayName.localeCompare(b.ownerDisplayName)
  );
}
