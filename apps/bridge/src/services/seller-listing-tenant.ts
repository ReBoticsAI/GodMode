import path from "node:path";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import type { CoreDatabase } from "../core-db.js";
import { configureDbPragmas } from "./db-config.js";
import { migrateTenantDb } from "../db.js";
import { ensureSellerAccount } from "./marketplace-commerce.js";
import { listUserTenants } from "./tenant-bootstrap.js";
import { ensureUserDb } from "../user-registry.js";

/**
 * Tenant id used for marketplace_listings.seller_tenant_id on Cloud.
 * Seller-only accounts (no workspace membership) get a listing-only tenant
 * without tenant_memberships so NoWorkspaceGate UX stays unchanged (#709).
 */
export function ensureSellerListingTenant(core: CoreDatabase, userId: string): string {
  const acct = ensureSellerAccount(core, userId);
  const stored = String(acct.listing_tenant_id ?? "").trim();
  if (stored) {
    const row = core.prepare(`SELECT id FROM tenants WHERE id=?`).get(stored) as
      | { id: string }
      | undefined;
    if (row) return stored;
  }

  const memberships = listUserTenants(core, userId);
  if (memberships.length > 0) {
    const tenantId = memberships[0]!.id;
    core
      .prepare(
        `UPDATE marketplace_seller_accounts
         SET listing_tenant_id=?, updated_at=datetime('now')
         WHERE user_id=?`
      )
      .run(tenantId, userId);
    return tenantId;
  }

  const tenantId = uuidv4();
  const slug = `seller-${userId.replace(/-/g, "").slice(0, 12)}`;
  ensureUserDb(userId);
  const tenantPath = path.join(config.tenantsDir, `${tenantId}.sqlite`);
  const db = new Database(tenantPath);
  configureDbPragmas(db);
  migrateTenantDb(db);
  db.close();

  core
    .prepare(
      `INSERT INTO tenants (id, name, slug, is_operator, owner_user_id)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(tenantId, "Seller listings", slug, userId);
  core
    .prepare(
      `UPDATE marketplace_seller_accounts
       SET listing_tenant_id=?, updated_at=datetime('now')
       WHERE user_id=?`
    )
    .run(tenantId, userId);
  return tenantId;
}
