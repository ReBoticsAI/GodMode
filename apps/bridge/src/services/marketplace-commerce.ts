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

/** Use 503 (not 502) for upstream payment-provider failures — Cloudflare replaces origin 502 bodies. */
export const MARKETPLACE_UPSTREAM_PAYMENT_STATUS = 503;

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

/** Gate-passing Community listing count thresholds (#313). */
export const COMMUNITY_VERIFIED_TIER_THRESHOLDS = {
  I: 3,
  II: 5,
  III: 10,
} as const;

export type CommunityVerifiedTier = 0 | 1 | 2 | 3;

/**
 * Join `marketplace_listings ml` to seller account + one aggregated gate-passing
 * count per seller. Use with COMMUNITY_VERIFIED_TIER_SQL (needs aliases sa, vc).
 * A grouped join stays O(listings); a correlated COUNT per row blocked Cloud.
 */
export const MARKETPLACE_LISTING_SELLER_JOINS = `LEFT JOIN marketplace_seller_accounts sa ON sa.user_id = ml.seller_user_id
  LEFT JOIN (
    SELECT seller_user_id, COUNT(*) AS gate_passing_cnt
    FROM marketplace_listings
    WHERE seller_kind = 'user' AND status = 'active' AND visibility = 'public'
    GROUP BY seller_user_id
  ) vc ON vc.seller_user_id = ml.seller_user_id`;

/**
 * SQL expression (aliases `ml` listing, `sa` seller account, `vc` gate counts)
 * for resolved Community verified_tier 0–3. Frozen forces 0; else max(earned, admin floor I).
 */
export const COMMUNITY_VERIFIED_TIER_SQL = `CASE
  WHEN COALESCE(sa.verified_frozen, 0) = 1 THEN 0
  ELSE max(
    CASE
      WHEN COALESCE(vc.gate_passing_cnt, 0) >= ${COMMUNITY_VERIFIED_TIER_THRESHOLDS.III} THEN 3
      WHEN COALESCE(vc.gate_passing_cnt, 0) >= ${COMMUNITY_VERIFIED_TIER_THRESHOLDS.II} THEN 2
      WHEN COALESCE(vc.gate_passing_cnt, 0) >= ${COMMUNITY_VERIFIED_TIER_THRESHOLDS.I} THEN 1
      ELSE 0
    END,
    CASE WHEN COALESCE(sa.verified_seller, 0) = 1 THEN 1 ELSE 0 END
  )
END`;

/** Map gate-passing listing count to earned tier (ignores admin freeze/floor). */
export function earnedVerifiedTier(listingCount: number): CommunityVerifiedTier {
  const n = Number.isFinite(listingCount) ? Math.max(0, Math.floor(listingCount)) : 0;
  if (n >= COMMUNITY_VERIFIED_TIER_THRESHOLDS.III) return 3;
  if (n >= COMMUNITY_VERIFIED_TIER_THRESHOLDS.II) return 2;
  if (n >= COMMUNITY_VERIFIED_TIER_THRESHOLDS.I) return 1;
  return 0;
}

/** Resolve display tier: freeze wins; else max(earned, admin verified floor of I). */
export function resolveVerifiedTier(opts: {
  earned: CommunityVerifiedTier | number;
  frozen?: boolean;
  verifiedSeller?: boolean;
}): CommunityVerifiedTier {
  if (opts.frozen) return 0;
  const earned = Math.min(
    3,
    Math.max(0, Math.floor(Number(opts.earned) || 0))
  ) as CommunityVerifiedTier;
  const floor: CommunityVerifiedTier = opts.verifiedSeller ? 1 : 0;
  return Math.max(earned, floor) as CommunityVerifiedTier;
}

/** Active public Community listings for a seller (post-intake live rows). */
export function countGatePassingCommunityListings(
  core: CoreDatabase,
  sellerUserId: string
): number {
  const row = core
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM marketplace_listings
       WHERE seller_user_id=?
         AND seller_kind='user'
         AND status='active'
         AND visibility='public'`
    )
    .get(sellerUserId) as { cnt: number } | undefined;
  return Number(row?.cnt ?? 0);
}

export function getSellerVerifiedSnapshot(
  core: CoreDatabase,
  sellerUserId: string
): {
  listingCount: number;
  earnedTier: CommunityVerifiedTier;
  verifiedSeller: boolean;
  verifiedFrozen: boolean;
  verifiedTier: CommunityVerifiedTier;
} {
  const row = core
    .prepare(
      `SELECT verified_seller, verified_frozen
       FROM marketplace_seller_accounts WHERE user_id=?`
    )
    .get(sellerUserId) as
    | { verified_seller?: number | null; verified_frozen?: number | null }
    | undefined;
  const listingCount = countGatePassingCommunityListings(core, sellerUserId);
  const earnedTier = earnedVerifiedTier(listingCount);
  const verifiedSeller = row?.verified_seller === 1;
  const verifiedFrozen = row?.verified_frozen === 1;
  return {
    listingCount,
    earnedTier,
    verifiedSeller,
    verifiedFrozen,
    verifiedTier: resolveVerifiedTier({
      earned: earnedTier,
      frozen: verifiedFrozen,
      verifiedSeller,
    }),
  };
}

/** True when resolved Community verified_tier > 0 (#311/#313). */
export function isSellerVerified(core: CoreDatabase, sellerUserId: string): boolean {
  return getSellerVerifiedSnapshot(core, sellerUserId).verifiedTier > 0;
}

export function setSellerVerified(
  core: CoreDatabase,
  opts: { userId: string; verified: boolean }
): Record<string, unknown> {
  const userId = opts.userId.trim();
  if (!userId) {
    throw new MarketplaceCommerceError("userId required");
  }
  const user = core.prepare(`SELECT id FROM users WHERE id=?`).get(userId) as
    | { id: string }
    | undefined;
  if (!user) {
    throw new MarketplaceCommerceError("User not found");
  }
  const row = ensureSellerAccount(core, userId);
  if (opts.verified) {
    core
      .prepare(
        `UPDATE marketplace_seller_accounts
         SET verified_seller=1, verified_frozen=0, updated_at=datetime('now')
         WHERE id=?`
      )
      .run(row.id);
  } else {
    core
      .prepare(
        `UPDATE marketplace_seller_accounts
         SET verified_seller=0, updated_at=datetime('now')
         WHERE id=?`
      )
      .run(row.id);
  }
  return core
    .prepare(`SELECT * FROM marketplace_seller_accounts WHERE id=?`)
    .get(row.id) as Record<string, unknown>;
}

export function setSellerVerifiedFrozen(
  core: CoreDatabase,
  opts: { userId: string; frozen: boolean }
): Record<string, unknown> {
  const userId = opts.userId.trim();
  if (!userId) {
    throw new MarketplaceCommerceError("userId required");
  }
  const user = core.prepare(`SELECT id FROM users WHERE id=?`).get(userId) as
    | { id: string }
    | undefined;
  if (!user) {
    throw new MarketplaceCommerceError("User not found");
  }
  const row = ensureSellerAccount(core, userId);
  core
    .prepare(
      `UPDATE marketplace_seller_accounts
       SET verified_frozen=?, updated_at=datetime('now')
       WHERE id=?`
    )
    .run(opts.frozen ? 1 : 0, row.id);
  return core
    .prepare(`SELECT * FROM marketplace_seller_accounts WHERE id=?`)
    .get(row.id) as Record<string, unknown>;
}

export type AdminSellerAccountRow = {
  id: string;
  userId: string;
  email: string | null;
  onboardingStatus: string;
  verifiedSeller: boolean;
  verifiedFrozen: boolean;
  earnedTier: CommunityVerifiedTier;
  verifiedTier: CommunityVerifiedTier;
  listingCount: number;
  updatedAt: string;
};

function adminSellerDto(
  core: CoreDatabase,
  r: {
    id: string;
    user_id: string;
    onboarding_status: string;
    verified_seller: number | null;
    verified_frozen: number | null;
    updated_at: string;
    email: string | null;
  }
): AdminSellerAccountRow {
  const snap = getSellerVerifiedSnapshot(core, r.user_id);
  return {
    id: r.id,
    userId: r.user_id,
    email: r.email,
    onboardingStatus: r.onboarding_status,
    verifiedSeller: snap.verifiedSeller,
    verifiedFrozen: snap.verifiedFrozen,
    earnedTier: snap.earnedTier,
    verifiedTier: snap.verifiedTier,
    listingCount: snap.listingCount,
    updatedAt: r.updated_at,
  };
}

/** Platform admin list of Community seller accounts with verified tier. */
export function listSellerAccountsForAdmin(
  core: CoreDatabase,
  limit = 200
): AdminSellerAccountRow[] {
  const capped = Math.min(Math.max(limit, 1), 500);
  const rows = core
    .prepare(
      `SELECT sa.id, sa.user_id, sa.onboarding_status, sa.verified_seller,
              COALESCE(sa.verified_frozen, 0) AS verified_frozen, sa.updated_at,
              u.email
       FROM marketplace_seller_accounts sa
       LEFT JOIN users u ON u.id = sa.user_id
       ORDER BY sa.updated_at DESC
       LIMIT ?`
    )
    .all(capped) as Array<{
    id: string;
    user_id: string;
    onboarding_status: string;
    verified_seller: number | null;
    verified_frozen: number | null;
    updated_at: string;
    email: string | null;
  }>;
  return rows.map((r) => adminSellerDto(core, r));
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
    /** Guest Local Buy (#584): Cloud ToS is not a Cloud user row. */
    skipBuyerTos?: boolean;
  }
): Record<string, unknown> {
  if (!opts.skipBuyerTos) {
    assertNotMarketplaceBanned(core, opts.buyerUserId);
    assertMarketplaceTosAccepted(core, opts.buyerUserId);
  }

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

/** After a successful acquire, move matching paid orders to delivered. */
export function markPaidOrdersDeliveredForListing(
  core: CoreDatabase,
  opts: { listingId: string; buyerUserId: string }
): void {
  const rows = core
    .prepare(
      `SELECT id FROM marketplace_orders
       WHERE listing_id=? AND buyer_user_id=? AND status='paid'`
    )
    .all(opts.listingId, opts.buyerUserId) as Array<{ id: string }>;
  for (const row of rows) {
    markOrderDelivered(core, row.id);
  }
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

function nonemptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export type SellerPayoutSnapshot = {
  stripeConnectAccountId: string | null;
  paypalMerchantId: string | null;
  metamaskAddress: string | null;
  onboardingStatus: string | null;
  payoutReady: boolean;
  stripePayoutsEnabled: boolean;
};

/**
 * Stored seller payout methods for Sell / Vault hydration.
 * Read-only: does not call Stripe, create a seller row, or require ToS.
 */
export function getSellerPayoutSnapshot(
  core: CoreDatabase,
  userId: string
): SellerPayoutSnapshot {
  const row = core
    .prepare(
      `SELECT stripe_connect_account_id, paypal_merchant_id, metamask_address, onboarding_status
       FROM marketplace_seller_accounts WHERE user_id=?`
    )
    .get(userId) as
    | {
        stripe_connect_account_id: string | null;
        paypal_merchant_id: string | null;
        metamask_address: string | null;
        onboarding_status: string | null;
      }
    | undefined;
  const stripeConnectAccountId = nonemptyText(row?.stripe_connect_account_id);
  const paypalMerchantId = nonemptyText(row?.paypal_merchant_id);
  const metamaskAddress = nonemptyText(row?.metamask_address);
  const onboardingStatus = nonemptyText(row?.onboarding_status);
  return {
    stripeConnectAccountId,
    paypalMerchantId,
    metamaskAddress,
    onboardingStatus,
    payoutReady: Boolean(stripeConnectAccountId || paypalMerchantId || metamaskAddress),
    stripePayoutsEnabled: onboardingStatus === "ready",
  };
}
