/** Format USD cents for Marketplace cards (Official + Community). */
export function formatMarketplaceCents(cents: number | null | undefined): string {
  const n = Number(cents ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "Free";
  return `$${(n / 100).toFixed(2)}`;
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
