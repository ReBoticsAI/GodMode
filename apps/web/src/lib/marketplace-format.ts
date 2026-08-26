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
  return "No plugins installed on this workspace. Use Official, Community, or Local to add one.";
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
  if (status === "pending_payout") return "Pending · awaiting payment setup";
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

export function marketplaceCloudCommunityUrl(
  origin =
    (import.meta.env.VITE_CLOUD_APP_ORIGIN as string | undefined)?.replace(/\/$/, "") ||
    "https://app.godmode.software"
): string {
  return `${origin}/marketplace?tab=community`;
}

export function marketplaceCloudSellUrl(
  origin =
    (import.meta.env.VITE_CLOUD_APP_ORIGIN as string | undefined)?.replace(/\/$/, "") ||
    "https://app.godmode.software"
): string {
  return `${origin}/marketplace?tab=seller`;
}

/** Cloud Personal Vault (GitHub Connect and integrations). */
export function marketplaceCloudVaultUrl(
  origin =
    (import.meta.env.VITE_CLOUD_APP_ORIGIN as string | undefined)?.replace(/\/$/, "") ||
    "https://app.godmode.software"
): string {
  return `${origin}/vault`;
}

/** Cloud Personal Vault Marketplace tab (Stripe Connect payouts). */
export function marketplaceCloudVaultMarketplaceUrl(
  origin =
    (import.meta.env.VITE_CLOUD_APP_ORIGIN as string | undefined)?.replace(/\/$/, "") ||
    "https://app.godmode.software"
): string {
  return `${origin}/vault?tab=marketplace`;
}

/** Signals for Local Sell checklist (#681). Seat from Cloud link; setup from Local or Cloud. */
export type LocalSellChecklistSignals = {
  linked: boolean;
  sellerActive: boolean;
  githubConnected: boolean;
  tosAccepted: boolean;
  stripePayoutReady: boolean;
};

export function localSellSeatReady(s: LocalSellChecklistSignals): boolean {
  return Boolean(s.linked && s.sellerActive);
}

export function localSellChecklistComplete(s: LocalSellChecklistSignals): boolean {
  return (
    localSellSeatReady(s) &&
    Boolean(s.githubConnected) &&
    Boolean(s.tosAccepted) &&
    Boolean(s.stripePayoutReady)
  );
}

/** Parse one-time Seller link exchange code from Local return URL query. */
export function sellerLinkExchangeFromSearch(search: string): string | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  );
  const code = params.get("seller_link_exchange");
  return code && code.trim() ? code.trim() : null;
}

/** Merge Cloud seller-link readiness with Local Vault / ToS state for unlock.
 * Local Sell publish gates on Local Marketplace ToS, so Cloud-only ToS does not
 * mark the checklist complete.
 */
export function mergeLocalSellChecklistSignals(opts: {
  linked: boolean;
  sellerActive: boolean;
  githubConnected: boolean;
  tosAccepted: boolean;
  stripePayoutReady: boolean;
  localGithubLogin?: string | null;
  localTosAccepted?: boolean;
  localPayoutReady?: boolean;
}): LocalSellChecklistSignals {
  return {
    linked: opts.linked,
    sellerActive: opts.sellerActive,
    githubConnected:
      Boolean(opts.githubConnected) || Boolean(String(opts.localGithubLogin ?? "").trim()),
    tosAccepted: Boolean(opts.localTosAccepted),
    stripePayoutReady: Boolean(opts.stripePayoutReady) || Boolean(opts.localPayoutReady),
  };
}

/** Public marketing seller storefront (Stripe business_profile.url shape). */
export function marketplaceSellerStorefrontUrl(
  handle: string,
  marketingOrigin =
    (import.meta.env.VITE_MARKETING_ORIGIN as string | undefined)?.replace(/\/$/, "") ||
    "https://godmode.software"
): string {
  const h = String(handle ?? "").trim();
  if (!h) return "";
  return `${marketingOrigin}/marketplace/${encodeURIComponent(h)}`;
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
 * Map commerce_config (camelCase), seller-account row (snake_case), or kernel
 * RecordRow `{ data }` to Sell/Vault payout UI state. Does not call Stripe.
 */
export function sellerPayoutStatusFromAccount(row: object): {
  stripeConnectId: string;
  paypalMerchantId: string;
  metamaskAddress: string;
  payoutReady: boolean;
} {
  const raw = row as Record<string, unknown>;
  const nested =
    raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
      ? (raw.data as Record<string, unknown>)
      : {};
  const rec = { ...nested, ...raw };
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
