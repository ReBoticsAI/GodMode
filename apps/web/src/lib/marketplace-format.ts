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
