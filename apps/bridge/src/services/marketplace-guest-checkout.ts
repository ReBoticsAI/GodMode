import { v4 as uuidv4 } from "uuid";
import type { CoreDatabase } from "../core-db.js";
import {
  MARKETPLACE_GUEST_TENANT_ID,
  MARKETPLACE_GUEST_USER_ID,
} from "../core-db.js";
import {
  createMarketplaceOrder,
  MarketplaceCommerceError,
  sellerSupportedProviders,
} from "./marketplace-commerce.js";
import { startMarketplaceCheckout } from "./marketplace-payments.js";

export type GuestDeliveryKind = "plugin" | "clone";

export function isAllowedMarketplaceReturnUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.replace("{CHECKOUT_SESSION_ID}", "cs_test"));
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && (host === "127.0.0.1" || host === "localhost" || host === "[::1]")) {
    return true;
  }
  if (url.protocol === "https:" && (host === "app.godmode.software" || host.endsWith(".godmode.software"))) {
    return true;
  }
  return false;
}

function requireReturnUrl(raw: unknown, kind: "success" | "cancel"): string {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url || !isAllowedMarketplaceReturnUrl(url)) {
    throw new MarketplaceCommerceError(`Invalid ${kind} URL`, 400);
  }
  if (kind === "success" && !url.includes("{CHECKOUT_SESSION_ID}")) {
    throw new MarketplaceCommerceError(
      "successUrl must include {CHECKOUT_SESSION_ID} so Local can verify the paid session",
      400
    );
  }
  return url;
}

function deliveryKindForListing(listing: Record<string, unknown>): GuestDeliveryKind {
  const mode = String(listing.delivery_mode ?? "clone").trim().toLowerCase();
  if (mode === "live") {
    throw new MarketplaceCommerceError(
      "Live Share stays on the seller host. It cannot be delivered to Local via checkout.",
      400
    );
  }
  const kind = String(listing.kind ?? "").trim().toLowerCase();
  if (kind === "plugin" || String(listing.catalog_entry_id ?? "").trim()) {
    return kind === "plugin" ? "plugin" : "clone";
  }
  return "clone";
}

export function upsertDeliveryGrant(
  core: CoreDatabase,
  opts: {
    stripeSessionId: string;
    orderId?: string | null;
    listingId?: string | null;
    catalogEntryId?: string | null;
    buyerEmail?: string | null;
    deliveryKind: GuestDeliveryKind;
    status: "pending" | "paid" | "delivered";
  }
): Record<string, unknown> {
  const existing = core
    .prepare(`SELECT * FROM marketplace_delivery_grants WHERE stripe_session_id=?`)
    .get(opts.stripeSessionId) as Record<string, unknown> | undefined;
  if (existing) {
    core
      .prepare(
        `UPDATE marketplace_delivery_grants
         SET order_id=COALESCE(?, order_id),
             listing_id=COALESCE(?, listing_id),
             catalog_entry_id=COALESCE(?, catalog_entry_id),
             buyer_email=COALESCE(?, buyer_email),
             status=?,
             updated_at=datetime('now')
         WHERE stripe_session_id=?`
      )
      .run(
        opts.orderId ?? null,
        opts.listingId ?? null,
        opts.catalogEntryId ?? null,
        opts.buyerEmail?.trim().toLowerCase() || null,
        opts.status,
        opts.stripeSessionId
      );
    return core
      .prepare(`SELECT * FROM marketplace_delivery_grants WHERE stripe_session_id=?`)
      .get(opts.stripeSessionId) as Record<string, unknown>;
  }
  const id = uuidv4();
  core
    .prepare(
      `INSERT INTO marketplace_delivery_grants
         (id, stripe_session_id, order_id, listing_id, catalog_entry_id, buyer_email, delivery_kind, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      opts.stripeSessionId,
      opts.orderId ?? null,
      opts.listingId ?? null,
      opts.catalogEntryId ?? null,
      opts.buyerEmail?.trim().toLowerCase() || null,
      opts.deliveryKind,
      opts.status
    );
  return core.prepare(`SELECT * FROM marketplace_delivery_grants WHERE id=?`).get(id) as Record<
    string,
    unknown
  >;
}

export function getDeliveryGrantBySession(
  core: CoreDatabase,
  sessionId: string
): Record<string, unknown> | undefined {
  return core
    .prepare(`SELECT * FROM marketplace_delivery_grants WHERE stripe_session_id=?`)
    .get(sessionId) as Record<string, unknown> | undefined;
}

export function markGrantPaidFromStripeSession(
  core: CoreDatabase,
  opts: { sessionId: string; orderId?: string; buyerEmail?: string | null }
): void {
  const grant = getDeliveryGrantBySession(core, opts.sessionId);
  if (!grant) return;
  upsertDeliveryGrant(core, {
    stripeSessionId: opts.sessionId,
    orderId: opts.orderId ?? (typeof grant.order_id === "string" ? grant.order_id : null),
    listingId: typeof grant.listing_id === "string" ? grant.listing_id : null,
    catalogEntryId: typeof grant.catalog_entry_id === "string" ? grant.catalog_entry_id : null,
    buyerEmail: opts.buyerEmail ?? (typeof grant.buyer_email === "string" ? grant.buyer_email : null),
    deliveryKind: String(grant.delivery_kind) === "clone" ? "clone" : "plugin",
    status: "paid",
  });
}

export function hasPaidDeliveryGrant(
  core: CoreDatabase,
  opts: { sessionId: string; listingId?: string | null; catalogEntryId?: string | null }
): boolean {
  const grant = getDeliveryGrantBySession(core, opts.sessionId);
  if (!grant) return false;
  const status = String(grant.status);
  if (status !== "paid" && status !== "delivered") return false;
  const listingId = String(opts.listingId ?? "").trim();
  const catalogId = String(opts.catalogEntryId ?? "").trim();
  if (listingId && String(grant.listing_id ?? "") === listingId) return true;
  if (catalogId && String(grant.catalog_entry_id ?? "") === catalogId) return true;
  return !listingId && !catalogId;
}

export async function createGuestMarketplaceCheckout(
  core: CoreDatabase,
  opts: {
    listingId: string;
    successUrl: string;
    cancelUrl: string;
    buyerEmail?: string;
    tosAccepted: boolean;
  }
): Promise<{ url: string; sessionId: string; orderId: string }> {
  if (!opts.tosAccepted) {
    throw new MarketplaceCommerceError("Accept Marketplace Terms before checkout", 400);
  }
  const listingId = opts.listingId.trim();
  if (!listingId) throw new MarketplaceCommerceError("listingId required", 400);
  const listing = core
    .prepare(
      `SELECT * FROM marketplace_listings
       WHERE id=? AND status='active' AND visibility='public'`
    )
    .get(listingId) as Record<string, unknown> | undefined;
  if (!listing) throw new MarketplaceCommerceError("Listing not found", 404);
  if (String(listing.seller_kind ?? "user") !== "user") {
    throw new MarketplaceCommerceError("Guest checkout is for Community listings", 400);
  }
  const deliveryKind = deliveryKindForListing(listing);
  const amountCents = Number(listing.price_cents ?? 0);
  if (amountCents <= 0) {
    throw new MarketplaceCommerceError("Free listings install without checkout", 400);
  }
  const sellerUserId = String(listing.seller_user_id ?? "");
  const supported = sellerSupportedProviders(core, sellerUserId, "user");
  if (!supported.includes("stripe")) {
    throw new MarketplaceCommerceError(
      "This seller has not connected Stripe. Paid Local Buy uses Stripe Connect.",
      400
    );
  }
  const successUrl = requireReturnUrl(opts.successUrl, "success");
  const cancelUrl = requireReturnUrl(opts.cancelUrl, "cancel");

  const order = createMarketplaceOrder(core, {
    listingId,
    catalogEntryId:
      typeof listing.catalog_entry_id === "string" ? listing.catalog_entry_id : null,
    buyerUserId: MARKETPLACE_GUEST_USER_ID,
    buyerTenantId: MARKETPLACE_GUEST_TENANT_ID,
    sellerUserId,
    sellerKind: "user",
    amountCents,
    currency: String(listing.currency || "usd"),
    provider: "stripe",
    skipBuyerTos: true,
  });

  const payout = core
    .prepare(
      `SELECT stripe_connect_account_id FROM marketplace_seller_accounts WHERE user_id=?`
    )
    .get(sellerUserId) as { stripe_connect_account_id?: string } | undefined;

  const checkout = await startMarketplaceCheckout(core, {
    orderId: String(order.id),
    successUrl,
    cancelUrl,
    buyerEmail: opts.buyerEmail,
    stripeConnectAccountId: payout?.stripe_connect_account_id ?? null,
  });
  if (!checkout.url || !checkout.sessionId) {
    throw new MarketplaceCommerceError("Stripe checkout missing session", 502);
  }
  upsertDeliveryGrant(core, {
    stripeSessionId: checkout.sessionId,
    orderId: String(order.id),
    listingId,
    catalogEntryId:
      typeof listing.catalog_entry_id === "string" ? listing.catalog_entry_id : null,
    buyerEmail: opts.buyerEmail ?? null,
    deliveryKind,
    status: "pending",
  });
  return { url: checkout.url, sessionId: checkout.sessionId, orderId: String(order.id) };
}

export function guestCheckoutStatus(
  core: CoreDatabase,
  sessionId: string
): { paid: boolean; status: string; listingId: string | null; catalogEntryId: string | null } {
  const grant = getDeliveryGrantBySession(core, sessionId);
  if (!grant) {
    throw new MarketplaceCommerceError("Checkout session not found", 404);
  }
  const status = String(grant.status);
  return {
    paid: status === "paid" || status === "delivered",
    status,
    listingId: typeof grant.listing_id === "string" ? grant.listing_id : null,
    catalogEntryId: typeof grant.catalog_entry_id === "string" ? grant.catalog_entry_id : null,
  };
}

export function guestCheckoutDelivery(
  core: CoreDatabase,
  sessionId: string
): {
  paid: true;
  deliveryKind: GuestDeliveryKind;
  listingId: string | null;
  catalogEntryId: string | null;
  bundle: unknown | null;
} {
  const grant = getDeliveryGrantBySession(core, sessionId);
  if (!grant) throw new MarketplaceCommerceError("Checkout session not found", 404);
  const status = String(grant.status);
  if (status !== "paid" && status !== "delivered") {
    throw new MarketplaceCommerceError("Payment is not complete", 402);
  }
  const listingId = typeof grant.listing_id === "string" ? grant.listing_id : null;
  const catalogEntryId =
    typeof grant.catalog_entry_id === "string" ? grant.catalog_entry_id : null;
  const deliveryKind: GuestDeliveryKind =
    String(grant.delivery_kind) === "clone" ? "clone" : "plugin";
  let bundle: unknown | null = null;
  if (deliveryKind === "clone" && listingId && !catalogEntryId) {
    const listing = core
      .prepare(`SELECT bundle_json FROM marketplace_listings WHERE id=?`)
      .get(listingId) as { bundle_json?: string } | undefined;
    if (listing?.bundle_json) {
      try {
        bundle = JSON.parse(listing.bundle_json) as unknown;
      } catch {
        bundle = null;
      }
    }
  }
  return { paid: true, deliveryKind, listingId, catalogEntryId, bundle };
}
