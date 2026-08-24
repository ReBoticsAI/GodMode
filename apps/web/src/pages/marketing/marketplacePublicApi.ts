import { CLOUD_APP_ORIGIN } from "./cloudAppUrl";

/** Cloud Bridge base for unauthenticated Marketplace public JSON (#688). */
export const MARKETPLACE_PUBLIC_API_BASE = `${CLOUD_APP_ORIGIN}/api/marketplace/commerce`;

export type PublicCatalogListing = {
  id: string;
  title?: string;
  description?: string | null;
  kind?: string;
  price_cents?: number;
  currency?: string;
  status?: string;
  catalog_entry_id?: string | null;
};

export type PublicOfficialEntry = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  priceCents?: number;
  price_cents?: number;
};

export type PublicSellerListing = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  priceCents: number;
  currency: string;
  status: string;
  catalogEntryId: string | null;
  deliveryMode: string | null;
  buyEnabled: boolean;
};

export type PublicSellerStorefront = {
  handle: string;
  storefrontUrl: string;
  listings: PublicSellerListing[];
};

export async function fetchPublicOfficialCatalog(): Promise<{
  entries: PublicOfficialEntry[];
}> {
  const res = await fetch(`${MARKETPLACE_PUBLIC_API_BASE}/catalog/official/public`);
  if (!res.ok) throw new Error(`Official catalog failed (${res.status})`);
  const json = (await res.json()) as {
    entries?: PublicOfficialEntry[];
    plugins?: PublicOfficialEntry[];
  };
  const entries = json.entries ?? json.plugins ?? [];
  return { entries: Array.isArray(entries) ? entries : [] };
}

export async function fetchPublicCommunityCatalog(): Promise<{
  listings: PublicCatalogListing[];
  entries: PublicOfficialEntry[];
}> {
  const res = await fetch(`${MARKETPLACE_PUBLIC_API_BASE}/catalog/community/public`);
  if (!res.ok) throw new Error(`Community catalog failed (${res.status})`);
  const json = (await res.json()) as {
    listings?: PublicCatalogListing[];
    entries?: PublicOfficialEntry[];
  };
  return {
    listings: Array.isArray(json.listings) ? json.listings : [],
    entries: Array.isArray(json.entries) ? json.entries : [],
  };
}

export async function fetchPublicSellerStorefront(
  handle: string
): Promise<PublicSellerStorefront | null> {
  const res = await fetch(
    `${MARKETPLACE_PUBLIC_API_BASE}/sellers/${encodeURIComponent(handle)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Seller storefront failed (${res.status})`);
  return (await res.json()) as PublicSellerStorefront;
}

export function cloudBuyListingUrl(listingId: string): string {
  return `${CLOUD_APP_ORIGIN}/marketplace?tab=community&listing=${encodeURIComponent(listingId)}`;
}

export function cloudOfficialMarketplaceUrl(): string {
  return `${CLOUD_APP_ORIGIN}/marketplace?tab=official`;
}

export function cloudCommunityMarketplaceUrl(): string {
  return `${CLOUD_APP_ORIGIN}/marketplace?tab=community`;
}

export function cloudSellUrl(): string {
  return `${CLOUD_APP_ORIGIN}/marketplace?tab=seller`;
}

export function formatPublicPriceCents(cents: number | null | undefined): string {
  const n = Number(cents ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "Free";
  return `$${(n / 100).toFixed(2)}`;
}
