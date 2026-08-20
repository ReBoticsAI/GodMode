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

export function isClonePackKind(kind: string): boolean {
  return (CLONE_PACK_KINDS as readonly string[]).includes(kind.trim());
}

/** Catalog installType clone maps to a listing kind (default bundle). */
export function listingKindFromCatalogEntry(entry: {
  installType?: string;
  kind?: string;
}): string {
  const install = String(entry.installType ?? "plugin").trim().toLowerCase();
  if (install === "clone") {
    const kind = String(entry.kind ?? "bundle").trim();
    return isClonePackKind(kind) ? kind : "bundle";
  }
  return PLUGIN_LISTING_KIND;
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
  const catalogId = String(opts.catalogEntryId ?? "").trim();
  const catalogBacked = kind === PLUGIN_LISTING_KIND || (Boolean(catalogId) && isClonePackKind(kind));
  if (catalogBacked) {
    if (!catalogId) {
      return {
        status: "draft",
        visibility: "private",
        error:
          kind === PLUGIN_LISTING_KIND
            ? "Plugin listings require a Community catalog entry id (intake CI + pin)."
            : "Clone pack listings require a Community catalog entry id (GitHub bundle pin).",
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

export function attachListingCommerceToCatalogEntry<
  T extends {
    id: string;
    listingId?: string;
    priceCents?: number;
    currency?: string;
    listingStatus?: string;
  },
>(
  entry: T,
  listingsByCatalogId: Map<
    string,
    { id: string; priceCents: number; currency: string; status: string }
  >
): T {
  const commerce = listingsByCatalogId.get(entry.id);
  if (!commerce) return entry;
  return {
    ...entry,
    listingId: commerce.id,
    priceCents: Number(entry.priceCents ?? 0) || commerce.priceCents,
    currency: entry.currency ?? commerce.currency,
    listingStatus: entry.listingStatus ?? commerce.status,
  };
}

export function communityPluginInstallBlock(opts: {
  priceCents: number;
  listingId?: string | null;
  listingStatus?: string | null;
}): string | null {
  const paid = Number(opts.priceCents) > 0;
  const listingId = String(opts.listingId ?? "").trim();
  if (!paid) return null;
  if (!listingId) {
    return "This Community catalog item has no seller listing. Paid install requires a listing and checkout.";
  }
  if (opts.listingStatus && opts.listingStatus !== "active") {
    return "This Community catalog listing is not public yet.";
  }
  return null;
}
