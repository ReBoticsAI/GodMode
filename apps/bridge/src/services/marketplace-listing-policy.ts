/** Community listing trust + commerce join (one listing record for every kind). */

export const PLUGIN_LISTING_KIND = "plugin";

/** Clone kinds that execute in the buyer workspace without plugin CI. */
export const EXECUTABLE_CLONE_KINDS = ["agent", "workflow", "skill"] as const;

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

export type ListingPublishStatus = "draft" | "in_review" | "active" | "archived";

export function isCommunityCatalogSource(url?: string | null): boolean {
  return String(url ?? "").toLowerCase().includes("/catalog/community");
}

export function catalogAuthorMatchesGithub(
  author: string | null | undefined,
  githubLogin: string | null | undefined
): boolean {
  const a = String(author ?? "").trim().toLowerCase();
  const login = String(githubLogin ?? "").trim().toLowerCase();
  if (!a || !login) return false;
  if (a === login) return true;
  if (a.endsWith(`/${login}`)) return true;
  if (a.startsWith(`${login}/`)) return true;
  return false;
}

export function pluginRepoOwnedByGithub(
  pluginRepo: string | null | undefined,
  githubLogin: string | null | undefined
): boolean {
  const repo = String(pluginRepo ?? "").trim().toLowerCase();
  const login = String(githubLogin ?? "").trim().toLowerCase();
  if (!repo || !login) return false;
  const path = repo
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return path === login || path.startsWith(`${login}/`);
}

export function sellerOwnsCatalogEntry(
  entry: { author?: string; pluginRepo?: string },
  githubLogin: string | null | undefined
): boolean {
  return (
    catalogAuthorMatchesGithub(entry.author, githubLogin) ||
    pluginRepoOwnedByGithub(entry.pluginRepo, githubLogin)
  );
}

export function resolveListingPublishState(opts: {
  kind: string;
  catalogEntryId?: string | null;
  priceCents?: number;
  payoutReady?: boolean;
  isSaas?: boolean;
}): { status: ListingPublishStatus; visibility: "public" | "private"; error?: string } {
  const kind = opts.kind.trim();
  if (kind === "inference" && opts.isSaas) {
    return {
      status: "draft",
      visibility: "private",
      error:
        "Inference listings are not available on GodMode Cloud. Metered model access runs on the seller Bridge (self-host or hub).",
    };
  }
  if (kind === PLUGIN_LISTING_KIND) {
    if (!String(opts.catalogEntryId ?? "").trim()) {
      return {
        status: "draft",
        visibility: "private",
        error: "Plugin listings require a Community catalog entry id (intake CI + pin).",
      };
    }
    const paid = Number(opts.priceCents ?? 0) > 0;
    if (paid && !opts.payoutReady) {
      return { status: "draft", visibility: "private" };
    }
    return { status: "active", visibility: "public" };
  }
  return { status: "in_review", visibility: "private" };
}

export function attachListingIdToCatalogEntry<
  T extends { id: string; listingId?: string },
>(entry: T, listingsByCatalogId: Map<string, string>): T {
  const listingId = listingsByCatalogId.get(entry.id) ?? entry.listingId;
  if (!listingId) return entry;
  return { ...entry, listingId };
}

export function communityPluginInstallBlock(opts: {
  priceCents: number;
  listingId?: string | null;
  listingStatus?: string | null;
}): string | null {
  const paid = Number(opts.priceCents) > 0;
  const listingId = String(opts.listingId ?? "").trim();
  if (!listingId) {
    return paid
      ? "This Community plugin has no seller listing. Paid install requires a listing and checkout."
      : "This Community plugin has no seller listing. The author must claim it on Marketplace → Sell.";
  }
  if (opts.listingStatus && opts.listingStatus !== "active") {
    return "This Community plugin listing is not public yet.";
  }
  return null;
}
