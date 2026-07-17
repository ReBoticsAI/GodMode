import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import type { CoreDatabase } from "../core-db.js";

export const MARKETPLACE_PLATFORM_FEE_BPS = 1000; // 10%
export const MARKETPLACE_TOS_VERSION = () =>
  (process.env.MARKETPLACE_TOS_VERSION ?? config.marketplace.tosVersion ?? "1").trim() || "1";

export type MarketplacePaymentProvider = "stripe" | "paypal" | "crypto";
export type MarketplaceOrderStatus =
  | "pending"
  | "awaiting_payment"
  | "paid"
  | "delivered"
  | "disputed"
  | "refunded"
  | "canceled";

export class MarketplaceCommerceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MarketplaceCommerceError";
    this.status = status;
  }
}

export function platformFeeCents(amountCents: number, sellerKind: "official" | "user"): number {
  if (sellerKind === "official" || amountCents <= 0) return 0;
  return Math.round((amountCents * MARKETPLACE_PLATFORM_FEE_BPS) / 10_000);
}

export function isMarketplaceBanned(core: CoreDatabase, userId: string): boolean {
  try {
    const row = core
      .prepare(`SELECT id FROM marketplace_bans WHERE user_id=?`)
      .get(userId) as { id: string } | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

export function assertNotMarketplaceBanned(core: CoreDatabase, userId: string): void {
  if (isMarketplaceBanned(core, userId)) {
    throw new MarketplaceCommerceError(
      "Marketplace access banned (chargeback or ToS violation). No buying or earning allowed.",
      403
    );
  }
}

export function hasAcceptedMarketplaceTos(core: CoreDatabase, userId: string): boolean {
  const version = MARKETPLACE_TOS_VERSION();
  try {
    const row = core
      .prepare(
        `SELECT id FROM marketplace_tos_acceptances WHERE user_id=? AND tos_version=?`
      )
      .get(userId, version) as { id: string } | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

export function assertMarketplaceTosAccepted(core: CoreDatabase, userId: string): void {
  if (!hasAcceptedMarketplaceTos(core, userId)) {
    throw new MarketplaceCommerceError(
      `Accept Marketplace Terms of Service (version ${MARKETPLACE_TOS_VERSION()}) before buying or selling.`,
      403
    );
  }
}

export function acceptMarketplaceTos(
  core: CoreDatabase,
  userId: string
): { tosVersion: string; acceptedAt: string } {
  assertNotMarketplaceBanned(core, userId);
  const tosVersion = MARKETPLACE_TOS_VERSION();
  const id = uuidv4();
  core
    .prepare(
      `INSERT INTO marketplace_tos_acceptances (id, user_id, tos_version)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, tos_version) DO NOTHING`
    )
    .run(id, userId, tosVersion);

  const seller = ensureSellerAccount(core, userId);
  core
    .prepare(
      `UPDATE marketplace_seller_accounts
       SET tos_accepted_version=?, tos_accepted_at=datetime('now'), updated_at=datetime('now')
       WHERE id=?`
    )
    .run(tosVersion, seller.id);

  const row = core
    .prepare(
      `SELECT accepted_at FROM marketplace_tos_acceptances WHERE user_id=? AND tos_version=?`
    )
    .get(userId, tosVersion) as { accepted_at: string };

  return { tosVersion, acceptedAt: row.accepted_at };
}

export function banMarketplaceUser(
  core: CoreDatabase,
  opts: { userId: string; reason: string; orderId?: string }
): Record<string, unknown> {
  const existing = core
    .prepare(`SELECT * FROM marketplace_bans WHERE user_id=?`)
    .get(opts.userId) as Record<string, unknown> | undefined;
  if (existing) return existing;
  const id = uuidv4();
  core
    .prepare(
      `INSERT INTO marketplace_bans (id, user_id, reason, order_id) VALUES (?, ?, ?, ?)`
    )
    .run(id, opts.userId, opts.reason, opts.orderId ?? null);
  return core.prepare(`SELECT * FROM marketplace_bans WHERE id=?`).get(id) as Record<
    string,
    unknown
  >;
}

export function ensureSellerAccount(
  core: CoreDatabase,
  userId: string
): Record<string, unknown> {
  const existing = core
    .prepare(`SELECT * FROM marketplace_seller_accounts WHERE user_id=?`)
    .get(userId) as Record<string, unknown> | undefined;
  if (existing) return existing;
  const id = uuidv4();
  core
    .prepare(
      `INSERT INTO marketplace_seller_accounts (id, user_id, onboarding_status)
       VALUES (?, ?, 'pending')`
    )
    .run(id, userId);
  return core
    .prepare(`SELECT * FROM marketplace_seller_accounts WHERE id=?`)
    .get(id) as Record<string, unknown>;
}

export function updateSellerPayout(
  core: CoreDatabase,
  opts: {
    userId: string;
    stripeConnectAccountId?: string | null;
    paypalMerchantId?: string | null;
    metamaskAddress?: string | null;
    payoutPreference?: "stripe" | "paypal" | "crypto" | null;
  }
): Record<string, unknown> {
  assertNotMarketplaceBanned(core, opts.userId);
  assertMarketplaceTosAccepted(core, opts.userId);
  const row = ensureSellerAccount(core, opts.userId);
  const stripe =
    opts.stripeConnectAccountId !== undefined
      ? opts.stripeConnectAccountId
      : row.stripe_connect_account_id;
  const paypal =
    opts.paypalMerchantId !== undefined ? opts.paypalMerchantId : row.paypal_merchant_id;
  const metamask =
    opts.metamaskAddress !== undefined ? opts.metamaskAddress : row.metamask_address;
  const pref =
    opts.payoutPreference !== undefined ? opts.payoutPreference : row.payout_preference;

  if (typeof metamask === "string" && metamask && !/^0x[a-fA-F0-9]{40}$/.test(metamask)) {
    throw new MarketplaceCommerceError("Invalid MetaMask address");
  }

  const ready = Boolean(stripe || paypal || metamask);
  core
    .prepare(
      `UPDATE marketplace_seller_accounts
       SET stripe_connect_account_id=?, paypal_merchant_id=?, metamask_address=?,
           payout_preference=?, onboarding_status=?, updated_at=datetime('now')
       WHERE id=?`
    )
    .run(
      stripe ?? null,
      paypal ?? null,
      metamask ?? null,
      pref ?? null,
      ready ? "ready" : "pending",
      row.id
    );
  return core
    .prepare(`SELECT * FROM marketplace_seller_accounts WHERE id=?`)
    .get(row.id) as Record<string, unknown>;
}

export function sellerSupportedProviders(
  core: CoreDatabase,
  sellerUserId: string | null,
  sellerKind: "official" | "user"
): MarketplacePaymentProvider[] {
  if (sellerKind === "official") {
    return ["stripe", "paypal", "crypto"];
  }
  if (!sellerUserId) return [];
  const acct = core
    .prepare(`SELECT * FROM marketplace_seller_accounts WHERE user_id=?`)
    .get(sellerUserId) as Record<string, unknown> | undefined;
  if (!acct) return [];
  const providers: MarketplacePaymentProvider[] = [];
  if (acct.stripe_connect_account_id) providers.push("stripe");
  if (acct.paypal_merchant_id) providers.push("paypal");
  if (acct.metamask_address) providers.push("crypto");
  return providers;
}

export function createMarketplaceOrder(
  core: CoreDatabase,
  opts: {
    listingId?: string | null;
    catalogEntryId?: string | null;
    buyerUserId: string;
    buyerTenantId: string;
    sellerUserId?: string | null;
    sellerKind: "official" | "user";
    amountCents: number;
    currency?: string;
    provider: MarketplacePaymentProvider;
  }
): Record<string, unknown> {
  assertNotMarketplaceBanned(core, opts.buyerUserId);
  assertMarketplaceTosAccepted(core, opts.buyerUserId);

  if (opts.amountCents < 0) {
    throw new MarketplaceCommerceError("Invalid amount");
  }

  const supported = sellerSupportedProviders(
    core,
    opts.sellerUserId ?? null,
    opts.sellerKind
  );
  if (opts.amountCents > 0 && !supported.includes(opts.provider)) {
    throw new MarketplaceCommerceError(
      `Provider ${opts.provider} is not available for this listing`,
      400
    );
  }

  const fee = platformFeeCents(opts.amountCents, opts.sellerKind);
  const id = uuidv4();
  core
    .prepare(
      `INSERT INTO marketplace_orders
         (id, listing_id, catalog_entry_id, buyer_user_id, buyer_tenant_id,
          seller_user_id, seller_kind, amount_cents, platform_fee_cents, currency,
          provider, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment')`
    )
    .run(
      id,
      opts.listingId ?? null,
      opts.catalogEntryId ?? null,
      opts.buyerUserId,
      opts.buyerTenantId,
      opts.sellerUserId ?? null,
      opts.sellerKind,
      opts.amountCents,
      fee,
      (opts.currency ?? "usd").toLowerCase(),
      opts.provider
    );
  return core.prepare(`SELECT * FROM marketplace_orders WHERE id=?`).get(id) as Record<
    string,
    unknown
  >;
}

export function getMarketplaceOrder(
  core: CoreDatabase,
  orderId: string
): Record<string, unknown> | undefined {
  return core.prepare(`SELECT * FROM marketplace_orders WHERE id=?`).get(orderId) as
    | Record<string, unknown>
    | undefined;
}

export function listOrdersForBuyer(
  core: CoreDatabase,
  buyerUserId: string
): Array<Record<string, unknown>> {
  return core
    .prepare(
      `SELECT * FROM marketplace_orders WHERE buyer_user_id=? ORDER BY created_at DESC`
    )
    .all(buyerUserId) as Array<Record<string, unknown>>;
}

export function markOrderProviderRef(
  core: CoreDatabase,
  orderId: string,
  providerRef: string
): void {
  core
    .prepare(
      `UPDATE marketplace_orders
       SET provider_ref=?, updated_at=datetime('now')
       WHERE id=?`
    )
    .run(providerRef, orderId);
}

export function markOrderPaid(
  core: CoreDatabase,
  opts: { orderId: string; providerRef?: string; cryptoTxHash?: string }
): Record<string, unknown> {
  const order = getMarketplaceOrder(core, opts.orderId);
  if (!order) throw new MarketplaceCommerceError("Order not found", 404);
  if (order.status === "paid" || order.status === "delivered") return order;

  core
    .prepare(
      `UPDATE marketplace_orders
       SET status='paid',
           provider_ref=COALESCE(?, provider_ref),
           crypto_tx_hash=COALESCE(?, crypto_tx_hash),
           updated_at=datetime('now')
       WHERE id=?`
    )
    .run(opts.providerRef ?? null, opts.cryptoTxHash ?? null, opts.orderId);

  return getMarketplaceOrder(core, opts.orderId)!;
}

export function markOrderDelivered(core: CoreDatabase, orderId: string): void {
  core
    .prepare(
      `UPDATE marketplace_orders
       SET status='delivered', delivered_at=datetime('now'), updated_at=datetime('now')
       WHERE id=? AND status IN ('paid', 'delivered')`
    )
    .run(orderId);
}

export function markOrderDisputedAndBanBuyer(
  core: CoreDatabase,
  opts: { orderId: string; reason?: string }
): void {
  const order = getMarketplaceOrder(core, opts.orderId);
  if (!order) return;
  core
    .prepare(
      `UPDATE marketplace_orders SET status='disputed', updated_at=datetime('now') WHERE id=?`
    )
    .run(opts.orderId);
  banMarketplaceUser(core, {
    userId: String(order.buyer_user_id),
    reason: opts.reason ?? "chargeback",
    orderId: opts.orderId,
  });
}

export function findOrderByProviderRef(
  core: CoreDatabase,
  provider: MarketplacePaymentProvider,
  providerRef: string
): Record<string, unknown> | undefined {
  return core
    .prepare(
      `SELECT * FROM marketplace_orders WHERE provider=? AND provider_ref=? ORDER BY created_at DESC LIMIT 1`
    )
    .get(provider, providerRef) as Record<string, unknown> | undefined;
}

export function hasPaidEntitlementForCatalogEntry(
  core: CoreDatabase,
  opts: { userId: string; catalogEntryId: string }
): boolean {
  const row = core
    .prepare(
      `SELECT id FROM marketplace_orders
       WHERE catalog_entry_id=? AND buyer_user_id=? AND status IN ('paid', 'delivered')
       LIMIT 1`
    )
    .get(opts.catalogEntryId, opts.userId) as { id: string } | undefined;
  return Boolean(row);
}

export function hasPaidEntitlementForListing(
  core: CoreDatabase,
  opts: { userId: string; listingId: string }
): boolean {
  const row = core
    .prepare(
      `SELECT id FROM marketplace_orders
       WHERE listing_id=? AND buyer_user_id=? AND status IN ('paid', 'delivered')
       LIMIT 1`
    )
    .get(opts.listingId, opts.userId) as { id: string } | undefined;
  if (row) return true;
  const purchase = core
    .prepare(
      `SELECT id FROM marketplace_purchases
       WHERE listing_id=? AND buyer_user_id=? LIMIT 1`
    )
    .get(opts.listingId, opts.userId) as { id: string } | undefined;
  return Boolean(purchase);
}

export function assertCanAcquireListing(
  core: CoreDatabase,
  opts: { userId: string; listing: Record<string, unknown> }
): void {
  assertNotMarketplaceBanned(core, opts.userId);
  const priceCents = Number(opts.listing.price_cents ?? 0);
  if (priceCents <= 0) return;
  assertMarketplaceTosAccepted(core, opts.userId);
  try {
    if (
      !hasPaidEntitlementForListing(core, {
        userId: opts.userId,
        listingId: String(opts.listing.id),
      })
    ) {
      throw new MarketplaceCommerceError(
        "Payment required before acquiring this listing. Complete checkout first.",
        402
      );
    }
  } catch (err) {
    if (err instanceof MarketplaceCommerceError) throw err;
    throw new MarketplaceCommerceError(
      "Payment required before acquiring this listing. Complete checkout first.",
      402
    );
  }
}

export function getPublicCommerceConfig(): {
  tosVersion: string;
  platformFeeBps: number;
  providers: {
    stripe: boolean;
    paypal: boolean;
    crypto: boolean;
  };
  cryptoTreasuryAddress: string | null;
  cryptoChainId: number;
  cryptoAsset: string;
} {
  return {
    tosVersion: MARKETPLACE_TOS_VERSION(),
    platformFeeBps: MARKETPLACE_PLATFORM_FEE_BPS,
    providers: {
      stripe: Boolean(config.marketplace.payments.stripeEnabled),
      paypal: Boolean(config.marketplace.payments.paypalEnabled),
      crypto: Boolean(config.marketplace.payments.cryptoTreasuryAddress),
    },
    cryptoTreasuryAddress: config.marketplace.payments.cryptoTreasuryAddress || null,
    cryptoChainId: config.marketplace.payments.cryptoChainId,
    cryptoAsset: config.marketplace.payments.cryptoAsset,
  };
}
