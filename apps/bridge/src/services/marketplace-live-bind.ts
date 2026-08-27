/**
 * Community Live Share bind + drift (#596).
 * Catalog pin is the product contract; seller live resource export must match.
 */
import { createHash } from "node:crypto";
import type { CoreDatabase, MarketplaceListingKind } from "../core-db.js";
import type { AppDatabase } from "../db.js";
import {
  fetchCatalogEntryBundle,
  fetchCommunityCatalog,
  findCatalogEntry,
  type CatalogEntry,
} from "./marketplace-catalog.js";
import {
  assertMarketplaceTosAccepted,
  assertNotMarketplaceBanned,
  assertStripeConnectAttestation,
  ensureSellerAccount,
} from "./marketplace-commerce.js";
import {
  listingKindFromCatalogEntry,
  resolveListingPublishState,
  sellerOwnsCatalogEntry,
} from "./marketplace-listing-policy.js";
import { publishMarketplaceListing } from "./marketplace-listings.js";
import { assertPluginInstallPin, resolvePluginPinPolicy } from "./marketplace-plugin-pin.js";
import { exportEntity, type PortableBundle } from "./portability.js";
import { config } from "../config.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Digest of durable bundle content (excludes exportedAt timestamps). */
export function portableBundleDigest(bundle: PortableBundle): string {
  const { exportedAt: _exportedAt, ...rest } = bundle;
  return createHash("sha256").update(stableJson(rest)).digest("hex");
}

export function demoteLiveListing(
  core: CoreDatabase,
  listingId: string,
  reason: string
): void {
  core
    .prepare(
      `UPDATE marketplace_listings
       SET status='draft', visibility='private', updated_at=datetime('now')
       WHERE id=? AND status != 'archived'`
    )
    .run(listingId);
  void reason;
}

/**
 * Re-export the bound resource and compare to stored digest.
 * Demotes and throws when drift is detected.
 */
export function assertLiveListingBoundFresh(
  core: CoreDatabase,
  tenantDb: AppDatabase,
  listing: Record<string, unknown>
): void {
  if (String(listing.delivery_mode ?? "") !== "live") return;
  const digest = String(listing.live_bundle_digest ?? "").trim();
  const resourceId = String(listing.live_resource_id ?? listing.resource_id ?? "").trim();
  const kind = String(listing.kind ?? "").trim();
  if (!digest || !resourceId || !kind) {
    demoteLiveListing(core, String(listing.id), "missing bind");
    throw Object.assign(
      new Error(
        "This Live Share listing is not bound to a catalog pin. The seller must re-bind before sales."
      ),
      { status: 409 }
    );
  }
  let exported: PortableBundle;
  try {
    exported = exportEntity(tenantDb, kind as MarketplaceListingKind, resourceId);
  } catch (err) {
    demoteLiveListing(core, String(listing.id), "export failed");
    throw Object.assign(
      new Error(
        err instanceof Error
          ? `Live Share bind check failed: ${err.message}`
          : "Live Share bind check failed"
      ),
      { status: 409 }
    );
  }
  const current = portableBundleDigest(exported);
  if (current !== digest) {
    demoteLiveListing(core, String(listing.id), "local drift");
    throw Object.assign(
      new Error(
        "Live Share resource drifted from the catalog pin. Revert local changes or open a new catalog PR and re-bind."
      ),
      { status: 409 }
    );
  }
}

/** When Community index pin bumps, demote live listings until sellers re-bind. */
export function demoteLiveListingsForCatalogPinChanges(
  core: CoreDatabase,
  entries: CatalogEntry[]
): number {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows = core
    .prepare(
      `SELECT id, catalog_entry_id, catalog_plugin_ref, catalog_plugin_digest, status
       FROM marketplace_listings
       WHERE delivery_mode='live'
         AND catalog_entry_id IS NOT NULL
         AND status IN ('active', 'draft')`
    )
    .all() as Array<{
    id: string;
    catalog_entry_id: string;
    catalog_plugin_ref: string | null;
    catalog_plugin_digest: string | null;
    status: string;
  }>;
  let demoted = 0;
  for (const row of rows) {
    const entry = byId.get(row.catalog_entry_id);
    if (!entry) continue;
    const ref = String(entry.pluginRef ?? "").trim();
    const digest = String(entry.pluginDigest ?? "").trim();
    const storedRef = String(row.catalog_plugin_ref ?? "").trim();
    const storedDigest = String(row.catalog_plugin_digest ?? "").trim();
    if (!storedRef && !storedDigest) continue;
    const refChanged = Boolean(storedRef) && ref !== storedRef;
    const digestChanged = Boolean(storedDigest) && digest && digest !== storedDigest;
    if (refChanged || digestChanged) {
      demoteLiveListing(core, row.id, "catalog pin bump");
      demoted += 1;
    }
  }
  return demoted;
}

export async function bindLiveListing(
  core: CoreDatabase,
  tenantDb: AppDatabase,
  opts: {
    sellerUserId: string;
    sellerTenantId: string;
    catalogEntryId: string;
    resourceId: string;
    kind?: string;
    title?: string;
    description?: string;
    priceCents?: number;
    githubLogin?: string | null;
    stripeConnectAttestation?: boolean;
    linkedCloudPayoutReady?: boolean;
  }
): Promise<Record<string, unknown>> {
  assertNotMarketplaceBanned(core, opts.sellerUserId);
  assertMarketplaceTosAccepted(core, opts.sellerUserId);
  assertStripeConnectAttestation(core, opts.sellerUserId, opts.stripeConnectAttestation);

  const catalogEntryId = String(opts.catalogEntryId ?? "").trim();
  const resourceId = String(opts.resourceId ?? "").trim();
  if (!catalogEntryId) {
    throw Object.assign(new Error("catalogEntryId is required to bind Live Share"), {
      status: 400,
    });
  }
  if (!resourceId) {
    throw Object.assign(new Error("resourceId is required to bind Live Share"), { status: 400 });
  }

  const { url, entries } = await fetchCommunityCatalog(core);
  const entry = entries.find((e) => e.id === catalogEntryId);
  if (!entry) {
    throw Object.assign(
      new Error(
        "Catalog entry must exist on the Community index with deliveryMode live. Submit a PR, wait for merge, then bind."
      ),
      { status: 400 }
    );
  }
  const delivery = String(entry.deliveryMode ?? "clone").trim().toLowerCase();
  if (delivery !== "live") {
    throw Object.assign(
      new Error("Only Community catalog entries with deliveryMode live can be bound as Live Share."),
      { status: 400 }
    );
  }
  if (!sellerOwnsCatalogEntry(entry, opts.githubLogin)) {
    throw Object.assign(
      new Error(
        "GitHub Connect must match the Community catalog author or pluginRepo owner before bind."
      ),
      { status: 400 }
    );
  }

  const found = await findCatalogEntry(catalogEntryId, { sourceCatalog: url });
  if (!found) {
    throw Object.assign(new Error("Could not resolve Community catalog index for bind"), {
      status: 503,
    });
  }

  const policy = resolvePluginPinPolicy({ entry, sourceCatalog: url });
  const pin = assertPluginInstallPin(entry, policy);
  const pinnedBundle = await fetchCatalogEntryBundle(entry, found.index, found.catalogUrl);
  const kind = String(opts.kind ?? listingKindFromCatalogEntry(entry)).trim();
  const exported = exportEntity(tenantDb, kind as MarketplaceListingKind, resourceId);
  const liveDigest = portableBundleDigest(exported);
  const pinDigest = portableBundleDigest(pinnedBundle);
  if (liveDigest !== pinDigest) {
    throw Object.assign(
      new Error(
        "Live resource export does not match the pinned catalog bundle. Align the workspace entity with the catalog pin, or open a new catalog PR."
      ),
      { status: 400 }
    );
  }

  const acct = ensureSellerAccount(core, opts.sellerUserId);
  const payoutReady =
    Boolean(opts.linkedCloudPayoutReady) ||
    Boolean(
      acct.stripe_connect_account_id || acct.paypal_merchant_id || acct.metamask_address
    );
  const publishState = resolveListingPublishState({
    kind,
    catalogEntryId,
    deliveryMode: "live",
    priceCents: opts.priceCents,
    payoutReady,
    isSaas: config.isSaas,
  });
  if (publishState.error) {
    throw Object.assign(new Error(publishState.error), { status: 400 });
  }

  const listing = publishMarketplaceListing(core, tenantDb, {
    sellerUserId: opts.sellerUserId,
    sellerTenantId: opts.sellerTenantId,
    kind: kind as MarketplaceListingKind,
    resourceId,
    catalogEntryId,
    catalogEntry: {
      id: entry.id,
      author: entry.author,
      pluginRepo: entry.pluginRepo,
    },
    githubLogin: opts.githubLogin,
    title: opts.title?.trim() || entry.title,
    description: opts.description?.trim() || entry.description,
    priceCents: opts.priceCents ?? Number(entry.priceCents ?? 0),
    sellerKind: "user",
    deliveryMode: "live",
    linkedCloudPayoutReady: opts.linkedCloudPayoutReady,
    stripeConnectAttestation: opts.stripeConnectAttestation,
  });

  const listingId = String(listing.id);
  core
    .prepare(
      `UPDATE marketplace_listings
       SET resource_id=?,
           catalog_plugin_ref=?,
           catalog_plugin_digest=?,
           live_resource_id=?,
           live_bundle_digest=?,
           live_bound_at=datetime('now'),
           delivery_mode='live',
           status=?,
           visibility=?,
           updated_at=datetime('now')
       WHERE id=? AND seller_user_id=?`
    )
    .run(
      resourceId,
      pin.ref,
      String(entry.pluginDigest ?? "").trim() || null,
      resourceId,
      liveDigest,
      publishState.status,
      publishState.visibility,
      listingId,
      opts.sellerUserId
    );

  return core.prepare("SELECT * FROM marketplace_listings WHERE id=?").get(listingId) as Record<
    string,
    unknown
  >;
}
