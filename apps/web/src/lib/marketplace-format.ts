export type MarketplaceTab = "official" | "local" | "community" | "installed" | "seller";

const MARKETPLACE_TABS: MarketplaceTab[] = [
  "official",
  "local",
  "community",
  "installed",
  "seller",
];

/** Local folder registration and unofficial catalogs are self-host / hub only. */
export function marketplaceShowsLocalTab(saas: boolean | null): boolean {
  return saas === false;
}

export function normalizeMarketplaceTab(
  raw: string | null,
  opts?: { saas?: boolean | null }
): MarketplaceTab {
  const tab = raw === "unofficial" ? "local" : raw;
  if (opts?.saas === true && tab === "local") return "community";
  if (MARKETPLACE_TABS.includes(tab as MarketplaceTab)) {
    return tab as MarketplaceTab;
  }
  return "official";
}

export function installedEmptyHint(saas: boolean): string {
  if (saas) {
    return "No plugins installed on this workspace. Use Official or Community to add one.";
  }
  return "No plugins installed on this workspace. Use Official or Local to add one.";
}

export const CLONE_PACK_KINDS = [
  "skill",
  "agent",
  "page",
  "workflow",
  "artifact",
  "rule",
  "knowledge",
  "dataset",
  "bundle",
] as const;

export type PublishFamily = "plugin" | "clone" | "live" | "inference";

export function userFacingErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg) return msg;
  }
  return fallback;
}

export function listingStatusLabel(status: string): string {
  if (status === "in_review") return "In review";
  if (status === "draft") return "Draft";
  if (status === "archived") return "Archived";
  if (status === "active") return "Listed";
  return status;
}

/** Format USD cents for Marketplace cards (Official + Community). */
export function formatMarketplaceCents(cents: number | null | undefined): string {
  const n = Number(cents ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "Free";
  return `$${(n / 100).toFixed(2)}`;
}

/**
 * Official tab empty-state copy (#434 / #380).
 * Cloud empty means feed/network/admin curation; local path is self-host/dev only.
 */
export function officialCatalogEmptyMessage(saas: boolean): string {
  if (saas) {
    return "No Official listings found. Check your network, or ask a platform admin to sync the Official catalog.";
  }
  return "No Official listings found. Check your network, or set MARKETPLACE_LOCAL_CATALOG_PATH for local dev.";
}

/** Checkout body for a Community (user) listing — listingId required. */
export function communityCheckoutBody(opts: {
  listingId: string;
  provider: "stripe" | "paypal" | "crypto";
  successUrl: string;
  cancelUrl: string;
}) {
  return {
    listingId: opts.listingId,
    provider: opts.provider,
    successUrl: opts.successUrl,
    cancelUrl: opts.cancelUrl,
  };
}

function firstNonemptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Map commerce_config (camelCase) or a seller-account row (snake_case) to Sell/Vault
 * payout UI state. Does not call Stripe.
 */
export function sellerPayoutStatusFromAccount(row: object): {
  stripeConnectId: string;
  paypalMerchantId: string;
  metamaskAddress: string;
  payoutReady: boolean;
} {
  const rec = row as Record<string, unknown>;
  const stripeConnectId = firstNonemptyString(
    rec.stripeConnectAccountId,
    rec.stripe_connect_account_id
  );
  const paypalMerchantId = firstNonemptyString(rec.paypalMerchantId, rec.paypal_merchant_id);
  const metamaskAddress = firstNonemptyString(rec.metamaskAddress, rec.metamask_address);
  const onboardingStatus = firstNonemptyString(rec.onboardingStatus, rec.onboarding_status);
  const payoutsEnabled =
    rec.stripePayoutsEnabled === true ||
    rec.stripePayoutsEnabled === 1 ||
    rec.stripe_payouts_enabled === true ||
    rec.stripe_payouts_enabled === 1;
  const payoutReady =
    rec.payoutReady === true ||
    onboardingStatus === "ready" ||
    payoutsEnabled ||
    Boolean(stripeConnectId || paypalMerchantId || metamaskAddress);
  return { stripeConnectId, paypalMerchantId, metamaskAddress, payoutReady };
}
