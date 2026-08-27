import type { CoreDatabase } from "../core-db.js";
import type { MarketplaceListingKind } from "../core-db.js";
import { getTenantDb } from "../tenant-registry.js";
import { fetchCommunityCatalog } from "./marketplace-catalog.js";
import {
  MarketplaceCommerceError,
} from "./marketplace-commerce.js";
import { publishMarketplaceListing } from "./marketplace-listings.js";
import { listingKindFromCatalogEntry } from "./marketplace-listing-policy.js";
import { getSellerEntitlementPayload } from "./saas-subscriptions.js";
import { ensureSellerListingTenant } from "./seller-listing-tenant.js";

export type SellerLinkCloudPublishInput = {
  kind?: string;
  catalogEntryId: string;
  title?: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  deliveryMode?: string;
  pricingModel?: string;
  pricePeriod?: string;
  meterUnit?: string;
  meterRate?: number;
  license?: string;
  stripeConnectAttestation?: boolean;
};

export async function publishListingForSellerLinkUser(
  core: CoreDatabase,
  cloudUserId: string,
  input: SellerLinkCloudPublishInput
): Promise<Record<string, unknown>> {
  const entitlement = getSellerEntitlementPayload(cloudUserId);
  if (!entitlement.sellerActive) {
    throw new MarketplaceCommerceError("Seller seat required to publish on Cloud", 403);
  }
  if (!entitlement.tosAccepted) {
    throw new MarketplaceCommerceError("Accept Marketplace Terms of Service on Cloud first", 400);
  }
  const catalogEntryId = String(input.catalogEntryId ?? "").trim();
  if (!catalogEntryId) {
    throw new MarketplaceCommerceError("catalog_entry_id required", 400);
  }

  const githubLogin = String(entitlement.githubLogin ?? "").trim() || null;
  if (!githubLogin) {
    throw new MarketplaceCommerceError(
      "Connect GitHub on your Seller Cloud account before publishing",
      400
    );
  }

  const paid = Number(input.priceCents ?? 0) > 0;
  if (paid && !entitlement.stripePayoutReady) {
    throw new MarketplaceCommerceError(
      "Connect Stripe on your Seller Cloud account before publishing a paid listing",
      400
    );
  }

  const { entries } = await fetchCommunityCatalog(core);
  const found = entries.find((e) => e.id === catalogEntryId);
  const catalogEntry = found
    ? {
        id: found.id,
        author: found.author,
        pluginRepo: found.pluginRepo,
      }
    : null;

  const kind =
    (typeof input.kind === "string" && input.kind.trim()) ||
    (found ? listingKindFromCatalogEntry(found) : "plugin");

  const sellerTenantId = ensureSellerListingTenant(core, cloudUserId);
  const tenantDb = getTenantDb(sellerTenantId);

  return publishMarketplaceListing(core, tenantDb, {
    sellerUserId: cloudUserId,
    sellerTenantId,
    kind: kind as MarketplaceListingKind,
    catalogEntryId,
    catalogEntry,
    githubLogin,
    title: input.title,
    description: input.description,
    priceCents: input.priceCents,
    currency: input.currency,
    deliveryMode:
      typeof input.deliveryMode === "string" ? (input.deliveryMode as never) : undefined,
    pricingModel:
      typeof input.pricingModel === "string" ? (input.pricingModel as never) : undefined,
    pricePeriod: input.pricePeriod,
    meterUnit: input.meterUnit,
    meterRate: input.meterRate,
    license: input.license,
    stripeConnectAttestation: input.stripeConnectAttestation === true,
  });
}
