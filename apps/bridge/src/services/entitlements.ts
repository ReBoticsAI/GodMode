import { v4 as uuidv4 } from "uuid";
import type {
  CoreDatabase,
  DeliveryMode,
  EntitlementStatus,
  MarketplaceListingKind,
  PricingModel,
} from "../core-db.js";
import { adjustCredits, CreditsError } from "./credits.js";
import { createShareGrant, revokeShareGrant } from "./share-service.js";
import { assertCanAcquireListing, markPaidOrdersDeliveredForListing } from "./marketplace-commerce.js";

export class EntitlementError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function periodToMs(period: string | null | undefined): number {
  switch (period) {
    case "day":
      return 24 * 60 * 60 * 1000;
    case "week":
      return 7 * 24 * 60 * 60 * 1000;
    case "year":
      return 365 * 24 * 60 * 60 * 1000;
    case "month":
    default:
      return 30 * 24 * 60 * 60 * 1000;
  }
}

export function computeExpiresAt(
  pricingModel: PricingModel,
  pricePeriod: string | null | undefined
): string | null {
  if (pricingModel !== "subscription") return null;
  const ms = periodToMs(pricePeriod);
  return new Date(Date.now() + ms).toISOString();
}

export function createEntitlement(
  core: CoreDatabase,
  opts: {
    listingId: string;
    buyerUserId: string;
    buyerTenantId: string;
    kind: MarketplaceListingKind;
    ownerTenantId: string;
    ownerUserId: string;
    resourceKind: MarketplaceListingKind;
    resourceId: string;
    shareGrantId: string;
    pricingModel: PricingModel;
    expiresAt?: string | null;
  }
): string {
  const id = uuidv4();
  core.prepare(
    `INSERT INTO marketplace_entitlements
       (id, listing_id, buyer_user_id, buyer_tenant_id, kind,
        owner_tenant_id, owner_user_id, resource_kind, resource_id,
        share_grant_id, pricing_model, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  ).run(
    id,
    opts.listingId,
    opts.buyerUserId,
    opts.buyerTenantId,
    opts.kind,
    opts.ownerTenantId,
    opts.ownerUserId,
    opts.resourceKind,
    opts.resourceId,
    opts.shareGrantId,
    opts.pricingModel,
    opts.expiresAt ?? null
  );
  return id;
}

export function listEntitlementsForBuyer(
  core: CoreDatabase,
  buyerUserId: string,
  buyerTenantId?: string
): Array<Record<string, unknown>> {
  if (buyerTenantId) {
    return core
      .prepare(
        `SELECT e.*, l.title AS listing_title, l.delivery_mode, l.price_credits
         FROM marketplace_entitlements e
         JOIN marketplace_listings l ON l.id = e.listing_id
         WHERE e.buyer_user_id=? AND e.buyer_tenant_id=?
         ORDER BY e.created_at DESC`
      )
      .all(buyerUserId, buyerTenantId) as Array<Record<string, unknown>>;
  }
  return core
    .prepare(
      `SELECT e.*, l.title AS listing_title, l.delivery_mode, l.price_credits
       FROM marketplace_entitlements e
       JOIN marketplace_listings l ON l.id = e.listing_id
       WHERE e.buyer_user_id=?
       ORDER BY e.created_at DESC`
    )
    .all(buyerUserId) as Array<Record<string, unknown>>;
}

export function cancelEntitlement(
  core: CoreDatabase,
  entitlementId: string,
  buyerUserId: string
): void {
  const row = core
    .prepare(
      `SELECT id, buyer_user_id, share_grant_id, owner_user_id, status
       FROM marketplace_entitlements WHERE id=?`
    )
    .get(entitlementId) as
    | {
        id: string;
        buyer_user_id: string;
        share_grant_id: string;
        owner_user_id: string;
        status: EntitlementStatus;
      }
    | undefined;
  if (!row) throw new EntitlementError(404, "Entitlement not found");
  if (row.buyer_user_id !== buyerUserId) {
    throw new EntitlementError(403, "Not entitlement owner");
  }
  if (row.status === "cancelled") return;
  core.prepare(
    `UPDATE marketplace_entitlements
     SET status='cancelled', updated_at=datetime('now')
     WHERE id=?`
  ).run(entitlementId);
  try {
    revokeShareGrant(core, row.share_grant_id, row.owner_user_id);
  } catch {
    core.prepare(`DELETE FROM share_grants WHERE id=?`).run(row.share_grant_id);
  }
}

export function acquireLiveListing(
  core: CoreDatabase,
  opts: {
    listing: Record<string, unknown>;
    buyerUserId: string;
    buyerTenantId: string;
  }
): { entitlementId: string; shareGrantId: string; balance: number } {
  const listing = opts.listing;
  assertCanAcquireListing(core, { userId: opts.buyerUserId, listing });
  const pricingModel = String(listing.pricing_model ?? "one_time") as PricingModel;
  const pricePeriod =
    typeof listing.price_period === "string" ? listing.price_period : "month";
  const priceCents = Number(listing.price_cents ?? 0);

  const tx = core.transaction(() => {
    const shareGrantId = createShareGrant(core, {
      ownerTenantId: String(listing.seller_tenant_id),
      ownerUserId: String(listing.seller_user_id),
      resourceKind: String(listing.kind) as MarketplaceListingKind,
      resourceId: String(listing.resource_id),
      granteeUserId: opts.buyerUserId,
      granteeTenantId: opts.buyerTenantId,
      role: "viewer",
    });

    const expiresAt = computeExpiresAt(pricingModel, pricePeriod);
    const entitlementId = createEntitlement(core, {
      listingId: String(listing.id),
      buyerUserId: opts.buyerUserId,
      buyerTenantId: opts.buyerTenantId,
      kind: String(listing.kind) as MarketplaceListingKind,
      ownerTenantId: String(listing.seller_tenant_id),
      ownerUserId: String(listing.seller_user_id),
      resourceKind: String(listing.kind) as MarketplaceListingKind,
      resourceId: String(listing.resource_id),
      shareGrantId,
      pricingModel,
      expiresAt,
    });

    core.prepare(
      `INSERT INTO marketplace_purchases
         (id, listing_id, buyer_user_id, buyer_tenant_id, price_credits)
       VALUES (?, ?, ?, ?, 0)`
    ).run(uuidv4(), listing.id, opts.buyerUserId, opts.buyerTenantId);

    return {
      entitlementId,
      shareGrantId,
      balance: 0,
      priceCents,
    };
  });

  const result = tx();

  markPaidOrdersDeliveredForListing(core, {
    listingId: String(listing.id),
    buyerUserId: opts.buyerUserId,
  });

  return {
    entitlementId: result.entitlementId,
    shareGrantId: result.shareGrantId,
    balance: 0,
  };
}

export function chargeSubscriptionPeriod(
  core: CoreDatabase,
  entitlement: Record<string, unknown>
): boolean {
  const listing = core
    .prepare("SELECT * FROM marketplace_listings WHERE id=?")
    .get(entitlement.listing_id) as Record<string, unknown> | undefined;
  if (!listing) return false;

  const price = Number(listing.price_credits ?? 0);
  const buyerUserId = String(entitlement.buyer_user_id);
  const pricePeriod =
    typeof listing.price_period === "string" ? listing.price_period : "month";

  try {
    const tx = core.transaction(() => {
      adjustCredits(core, {
        userId: buyerUserId,
        delta: -price,
        reason: "subscription_renewal",
        refType: "entitlement",
        refId: String(entitlement.id),
      });
      const sellerId = String(listing.seller_user_id);
      if (sellerId !== buyerUserId) {
        adjustCredits(core, {
          userId: sellerId,
          delta: price,
          reason: "subscription_sale",
          refType: "entitlement",
          refId: String(entitlement.id),
        });
      }
      const expiresAt = computeExpiresAt("subscription", pricePeriod);
      core.prepare(
        `UPDATE marketplace_entitlements
         SET expires_at=?, status='active', updated_at=datetime('now')
         WHERE id=?`
      ).run(expiresAt, entitlement.id);
    });
    tx();
    return true;
  } catch (err) {
    if (err instanceof CreditsError) return false;
    throw err;
  }
}

export function expireEntitlement(core: CoreDatabase, entitlementId: string): void {
  const row = core
    .prepare(
      `SELECT id, buyer_user_id, share_grant_id, owner_user_id
       FROM marketplace_entitlements WHERE id=?`
    )
    .get(entitlementId) as
    | {
        id: string;
        buyer_user_id: string;
        share_grant_id: string;
        owner_user_id: string;
      }
    | undefined;
  if (!row) return;
  core.prepare(
    `UPDATE marketplace_entitlements
     SET status='expired', updated_at=datetime('now')
     WHERE id=?`
  ).run(entitlementId);
  try {
    revokeShareGrant(core, row.share_grant_id, row.owner_user_id);
  } catch {
    core.prepare(`DELETE FROM share_grants WHERE id=?`).run(row.share_grant_id);
  }
}
