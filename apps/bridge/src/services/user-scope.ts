import { getCoreDb } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import type { AppDatabase } from "../db.js";
import { getOperatorTenantIdCached } from "./auth/middleware.js";

/** Owner workspace tenant for a human user (non-operator). */
export function getUserOwnerTenantId(userId: string): string {
  const core = getCoreDb();
  const row = core
    .prepare(
      `SELECT id FROM tenants WHERE owner_user_id=? AND is_operator=0 LIMIT 1`
    )
    .get(userId) as { id: string } | undefined;
  return row?.id ?? getOperatorTenantIdCached();
}

export function getUserOwnerTenantDb(userId: string): AppDatabase {
  return getTenantDb(getUserOwnerTenantId(userId));
}

/** Resolve the human owner of a tenant workspace. */
export function getTenantOwnerUserId(tenantId: string): string | null {
  const core = getCoreDb();
  const row = core
    .prepare(`SELECT owner_user_id FROM tenants WHERE id=?`)
    .get(tenantId) as { owner_user_id: string } | undefined;
  return row?.owner_user_id ?? null;
}
