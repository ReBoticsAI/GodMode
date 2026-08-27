import { config } from "../config.js";
import type { CatalogEntry } from "./marketplace-catalog.js";

export const COMMUNITY_SHELF_COMMERCE_HOST = "cloud";

export type PublicCommunityListing = Record<string, unknown> & {
  id?: string;
  commerce_host?: string;
};

export type PublicCommunityShelf = {
  catalogUrl: string;
  entries: CatalogEntry[];
  listings: PublicCommunityListing[];
};

type ShelfCache = {
  url: string;
  fetchedAt: number;
  shelf: PublicCommunityShelf;
};

const shelfCache = new Map<string, ShelfCache>();
const shelfInflight = new Map<string, Promise<PublicCommunityShelf>>();

export function resetRemoteCommunityShelfCacheForTests(): void {
  shelfCache.clear();
  shelfInflight.clear();
}

/** Bust cached Cloud shelf after Local Sell publishes to Cloud (#709). */
export function invalidateRemoteCommunityShelfCache(): void {
  shelfCache.clear();
  shelfInflight.clear();
}

function catalogFetchTimeoutMs(): number {
  const n = Number(config.marketplace.catalogFetchTimeoutMs);
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

export function applyCommunityCommerceOverlay(
  localEntries: CatalogEntry[],
  remoteEntries: CatalogEntry[]
): CatalogEntry[] {
  if (remoteEntries.length === 0) return localEntries;
  const byId = new Map(remoteEntries.map((entry) => [entry.id, entry]));
  return localEntries.map((entry) => {
    const remote = byId.get(entry.id);
    if (!remote) return entry;
    const localListing = String(entry.listingId ?? "").trim();
    const remoteListing = String(remote.listingId ?? "").trim();
    return {
      ...entry,
      // Cloud is checkout authority on Local; prefer Cloud listing id when present.
      listingId: remoteListing || localListing || undefined,
      listingStatus: entry.listingStatus ?? remote.listingStatus,
      priceCents: Number(entry.priceCents ?? 0) || Number(remote.priceCents ?? 0),
      currency: entry.currency ?? remote.currency,
      verifiedPublisher: entry.verifiedPublisher === true || remote.verifiedPublisher === true,
      commerceHost: remoteListing
        ? COMMUNITY_SHELF_COMMERCE_HOST
        : localListing
          ? entry.commerceHost
          : entry.commerceHost,
    };
  });
}

export function mergePublicListings(
  localListings: PublicCommunityListing[],
  remoteListings: PublicCommunityListing[]
): PublicCommunityListing[] {
  const seen = new Set<string>();
  const merged: PublicCommunityListing[] = [];
  for (const row of localListings) {
    const id = String(row.id ?? "").trim();
    if (id) seen.add(id);
    merged.push(row);
  }
  for (const row of remoteListings) {
    const id = String(row.id ?? "").trim();
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push({ ...row, commerce_host: row.commerce_host ?? COMMUNITY_SHELF_COMMERCE_HOST });
  }
  return merged;
}

function parsePublicCommunityShelf(url: string, json: unknown): PublicCommunityShelf {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const entries = Array.isArray(body.entries) ? (body.entries as CatalogEntry[]) : [];
  const listings = Array.isArray(body.listings)
    ? (body.listings as PublicCommunityListing[])
    : [];
  return {
    catalogUrl: typeof body.catalogUrl === "string" ? body.catalogUrl : url,
    entries,
    listings,
  };
}

/** Pull the Cloud Community shelf (catalog + public listings). No-op on SaaS. */
export async function fetchRemoteCommunityShelf(): Promise<PublicCommunityShelf | null> {
  if (config.isSaas) return null;
  const url = config.marketplace.saasCommunityCatalogUrl.trim();
  if (!url) return null;

  const cached = shelfCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < config.marketplace.cacheTtlMs) {
    return cached.shelf;
  }

  const inflight = shelfInflight.get(url);
  if (inflight) return inflight;

  const pending = (async () => {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(catalogFetchTimeoutMs()),
      });
      if (!res.ok) {
        throw new Error(`Community shelf fetch failed (${res.status}): ${url}`);
      }
      const shelf = parsePublicCommunityShelf(url, await res.json());
      shelfCache.set(url, { url, fetchedAt: Date.now(), shelf });
      return shelf;
    } catch (err) {
      if (cached) {
        console.warn(
          `[catalog] using stale Cloud Community shelf for ${url}:`,
          err instanceof Error ? err.message : err
        );
        return cached.shelf;
      }
      console.warn(
        "[catalog] Cloud Community shelf unavailable:",
        err instanceof Error ? err.message : err
      );
      return {
        catalogUrl: url,
        entries: [],
        listings: [],
      };
    } finally {
      shelfInflight.delete(url);
    }
  })();

  shelfInflight.set(url, pending);
  return pending;
}
