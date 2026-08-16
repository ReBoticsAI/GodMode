import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  acceptMarketplaceTos,
  acquireMarketplaceListing,
  addCatalogSource,
  archiveMarketplaceListing,
  confirmMarketplaceCryptoPayment,
  createMarketplaceListing,
  fetchInstalledCatalog,
  fetchMarketplaceCommerceConfig,
  fetchMarketplaceEntitlements,
  fetchMarketplaceListings,
  fetchMyMarketplaceListings,
  fetchOfficialCatalog,
  fetchCommunityCatalog,
  fetchUnofficialCatalog,
  fetchBridgeHealth,
  installCatalogEntry,
  installWorkspacePlugin,
  refreshMarketplaceStripeConnect,
  registerLocalPlugin,
  removeCatalogSource,
  removeLocalPlugin,
  startMarketplaceCheckout,
  uninstallWorkspacePlugin,
  type CatalogEntry,
  type DiscoveredPlugin,
  type MarketplaceEntitlement,
  type MarketplaceListing,
  type TenantPluginRow,
} from "@/api";
import {
  communityCheckoutBody,
  formatMarketplaceCents,
  installedEmptyHint,
  marketplaceShowsLocalTab,
  normalizeMarketplaceTab,
  officialCatalogEmptyMessage,
} from "@/lib/marketplace-format";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/PageHeader";
import { VAULT_PATH } from "@/lib/navigation";
import { FolderOpenIcon, StoreIcon, Trash2Icon } from "lucide-react";

const OFFICIAL_REPO =
  "https://github.com/ReBoticsAI/GodMode-Marketplace/blob/main/CONTRIBUTING.md";

const LISTING_KINDS = [
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

function reloadAfterPluginChange(built?: boolean) {
  if (built) {
    toast.info("Plugin was built — reloading to activate UI…");
  } else {
    toast.info("Reloading to activate plugin UI…");
  }
  window.setTimeout(() => window.location.reload(), 400);
}

function formatPrice(entry: CatalogEntry): string {
  return formatMarketplaceCents(entry.priceCents);
}

function EntryCard({
  entry,
  installed,
  onInstall,
  onBuy,
  installing,
  buying,
}: {
  entry: CatalogEntry;
  installed: boolean;
  onInstall: () => void;
  onBuy: (provider: "stripe" | "paypal" | "crypto") => void;
  installing: boolean;
  buying: boolean;
}) {
  const paid = Number(entry.priceCents ?? 0) > 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{entry.title}</CardTitle>
            <CardDescription className="text-xs">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span>
                  {entry.author} · v{entry.version} · {entry.kind}
                </span>
                {entry.verifiedPublisher ? (
                  <Badge variant="outline">Verified</Badge>
                ) : null}
              </span>
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={paid ? "default" : "secondary"}>{formatPrice(entry)}</Badge>
            {entry.sourceName ? (
              <Badge variant="outline">{entry.sourceName}</Badge>
            ) : null}
            {installed ? <Badge variant="secondary">Installed</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{entry.description}</p>
        {entry.tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-xs">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
        {paid && !installed ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onBuy("stripe")} disabled={buying || installing}>
              {buying ? "Starting…" : "Buy (Card)"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBuy("paypal")}
              disabled={buying || installing}
            >
              PayPal
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBuy("crypto")}
              disabled={buying || installing}
            >
              Crypto
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onInstall}
              disabled={installing || buying}
            >
              {installing ? "Installing…" : "Install if owned"}
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={onInstall} disabled={installing || installed}>
            {installed ? "Installed" : installing ? "Installing…" : "Install"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CommunityListingCard({
  listing,
  owned,
  onAcquire,
  onBuy,
  busy,
}: {
  listing: MarketplaceListing;
  owned: boolean;
  onAcquire: () => void;
  onBuy: (provider: "stripe" | "paypal" | "crypto") => void;
  busy: boolean;
}) {
  const paid = Number(listing.price_cents ?? 0) > 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{listing.title}</CardTitle>
            <CardDescription className="text-xs">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span>
                  {listing.kind} · {listing.delivery_mode ?? "clone"}
                </span>
                {(() => {
                  const tier = Number(listing.verified_tier ?? 0);
                  const label =
                    tier >= 3
                      ? "Verified III"
                      : tier >= 2
                        ? "Verified II"
                        : tier >= 1
                          ? "Verified I"
                          : listing.verified_publisher
                            ? "Verified I"
                            : null;
                  return label ? <Badge variant="outline">{label}</Badge> : null;
                })()}
              </span>
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={paid ? "default" : "secondary"}>
              {formatMarketplaceCents(listing.price_cents)}
            </Badge>
            {owned ? <Badge variant="secondary">Owned</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {listing.description?.trim() || "No description"}
        </p>
        {paid && !owned ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onBuy("stripe")} disabled={busy}>
              {busy ? "Starting…" : "Buy (Card)"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onBuy("paypal")} disabled={busy}>
              PayPal
            </Button>
            <Button size="sm" variant="outline" onClick={() => onBuy("crypto")} disabled={busy}>
              Crypto
            </Button>
            <Button size="sm" variant="ghost" onClick={onAcquire} disabled={busy}>
              Acquire if owned
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={onAcquire} disabled={busy || owned}>
            {owned ? "Owned" : busy ? "Acquiring…" : "Acquire"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function DiscoveredPluginRow({
  plugin,
  busy,
  onInstall,
  onUninstall,
  onRemovePath,
}: {
  plugin: DiscoveredPlugin;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onRemovePath?: () => void;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{plugin.name}</span>
          <span className="text-muted-foreground">({plugin.id})</span>
          {plugin.installed ? (
            <Badge variant="secondary" className="text-xs">
              Installed
            </Badge>
          ) : null}
          {!plugin.loaded ? (
            <Badge variant="outline" className="text-xs text-amber-600">
              Not loaded
            </Badge>
          ) : null}
          {plugin.source === "env" ? (
            <Badge variant="outline" className="text-xs">
              env path
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{plugin.pluginRoot}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {plugin.installed ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onUninstall}>
            Uninstall
          </Button>
        ) : (
          <Button size="sm" disabled={!plugin.loaded || busy} onClick={onInstall}>
            Install
          </Button>
        )}
        {plugin.source === "marketplace" && onRemovePath ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRemovePath}>
            <Trash2Icon className="size-4" />
            Remove path
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export default function MarketplacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() =>
    normalizeMarketplaceTab(searchParams.get("tab"))
  );
  const [official, setOfficial] = useState<CatalogEntry[]>([]);
  const [localCatalog, setLocalCatalog] = useState<CatalogEntry[]>([]);
  const [communityListings, setCommunityListings] = useState<MarketplaceListing[]>([]);
  const [communityCatalog, setCommunityCatalog] = useState<CatalogEntry[]>([]);
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [entitlements, setEntitlements] = useState<MarketplaceEntitlement[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredPlugin[]>([]);
  const [localPaths, setLocalPaths] = useState<string[]>([]);
  const [sources, setSources] = useState<Array<{ id: string; name: string; url: string }>>(
    []
  );
  const [catalogInstalls, setCatalogInstalls] = useState<Array<Record<string, unknown>>>(
    []
  );
  const [tenantPlugins, setTenantPlugins] = useState<TenantPluginRow[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [addingLocal, setAddingLocal] = useState(false);
  const [saas, setSaas] = useState<boolean | null>(null);
  const showLocalTab = marketplaceShowsLocalTab(saas);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [acquiringId, setAcquiringId] = useState<string | null>(null);
  const [cryptoPrompt, setCryptoPrompt] = useState<{
    orderId: string;
    treasuryAddress: string;
    amountCents: number;
    asset: string;
    chainId: number;
  } | null>(null);
  const [cryptoTxHash, setCryptoTxHash] = useState("");
  const [tosVersion, setTosVersion] = useState("1");
  const [platformFeeBps, setPlatformFeeBps] = useState(1000);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [payoutReady, setPayoutReady] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishKind, setPublishKind] = useState<string>("skill");
  const [publishTitle, setPublishTitle] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishPriceDollars, setPublishPriceDollars] = useState("0");
  const [publishDelivery, setPublishDelivery] = useState<"clone" | "live">("clone");
  const [publishResourceId, setPublishResourceId] = useState("");

  useEffect(() => {
    void fetchBridgeHealth()
      .then((h) => setSaas(Boolean(h.saas)))
      .catch(() => setSaas(false));
  }, []);

  const ownedListingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entitlements) {
      if (e.status === "active" || e.status === "cancelled") ids.add(e.listing_id);
    }
    return ids;
  }, [entitlements]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [off, local, inst, community, communityCat, mine, ents] = await Promise.all([
        fetchOfficialCatalog(),
        fetchUnofficialCatalog(),
        fetchInstalledCatalog(),
        fetchMarketplaceListings({ sellerKind: "user" }).catch(() => ({ listings: [] })),
        fetchCommunityCatalog().catch(() => ({ catalogUrl: "", entries: [] as CatalogEntry[] })),
        fetchMyMarketplaceListings().catch(() => ({ listings: [] })),
        fetchMarketplaceEntitlements().catch(() => ({ entitlements: [] })),
      ]);
      setOfficial(off.entries);
      setLocalCatalog(local.entries);
      setSources(local.sources);
      setDiscovered(local.discovered);
      setLocalPaths(local.localPaths);
      setCatalogInstalls(inst.catalogInstalls);
      setTenantPlugins(inst.plugins);
      setCommunityListings(community.listings);
      setCommunityCatalog(communityCat.entries);
      setMyListings(mine.listings);
      setEntitlements(ents.entitlements);
      const ids = new Set(inst.plugins.map((p) => p.plugin_id));
      setInstalledIds(ids);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load marketplace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void fetchMarketplaceCommerceConfig()
      .then((cfg) => {
        setTosVersion(cfg.tosVersion);
        setPlatformFeeBps(cfg.platformFeeBps);
      })
      .catch(() => undefined);
  }, [reload]);

  // Hydrate seller payout readiness for paid publish gating (Connect lives in Vault).
  useEffect(() => {
    if (tab !== "seller") return;
    let cancelled = false;
    void refreshMarketplaceStripeConnect()
      .then((row) => {
        if (cancelled) return;
        const acct = String(row.stripe_connect_account_id ?? "");
        const ready =
          row.onboarding_status === "ready" ||
          row.stripe_payouts_enabled === true ||
          row.stripe_payouts_enabled === 1;
        setPayoutReady(Boolean(ready) || Boolean(acct));
      })
      .catch(() => {
        if (!cancelled) setPayoutReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    const paid = searchParams.get("paid");
    const canceled = searchParams.get("canceled");
    if (paid === "1") {
      toast.success("Payment complete — install or acquire your purchase.");
      const next = new URLSearchParams(searchParams);
      next.delete("paid");
      next.delete("entry");
      next.delete("listing");
      setSearchParams(next, { replace: true });
      void reload();
    } else if (canceled === "1") {
      toast.message("Checkout canceled");
      const next = new URLSearchParams(searchParams);
      next.delete("canceled");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, reload]);

  useEffect(() => {
    if (saas === null) return;
    const raw = searchParams.get("tab");
    const nextTab = normalizeMarketplaceTab(raw ?? tab, { saas });
    if (nextTab === tab && raw === nextTab) return;
    if (raw === "unofficial" || (saas && (raw === "local" || tab === "local"))) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", nextTab);
      setSearchParams(next, { replace: true });
    }
    if (tab !== nextTab) setTab(nextTab);
  }, [saas, searchParams, setSearchParams, tab]);

  const handleTabChange = (value: string) => {
    const nextTab = normalizeMarketplaceTab(value, { saas });
    if (nextTab === "local" && !showLocalTab) return;
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    setSearchParams(next, { replace: true });
  };

  const filterEntries = (entries: CatalogEntry[]) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle) ||
        e.tags?.some((t) => t.toLowerCase().includes(needle))
    );
  };

  const officialFiltered = useMemo(() => filterEntries(official), [official, q]);
  const localFiltered = useMemo(() => filterEntries(localCatalog), [localCatalog, q]);
  const communityCatalogFiltered = useMemo(
    () => filterEntries(communityCatalog),
    [communityCatalog, q]
  );
  const communityFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return communityListings;
    return communityListings.filter(
      (l) =>
        l.title.toLowerCase().includes(needle) ||
        String(l.description ?? "")
          .toLowerCase()
          .includes(needle) ||
        l.kind.toLowerCase().includes(needle)
    );
  }, [communityListings, q]);
  const discoveredFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return discovered;
    return discovered.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.id.toLowerCase().includes(needle) ||
        p.pluginRoot.toLowerCase().includes(needle)
    );
  }, [discovered, q]);

  const handleInstall = async (entry: CatalogEntry) => {
    setInstallingId(entry.id);
    try {
      const result = await installCatalogEntry(entry.id, entry.sourceCatalog);
      toast.success(`Installed ${entry.title}`);
      if (result.built) {
        toast.info("Plugin was built automatically");
      }
      if (result.restartRequired) {
        toast.info("Restart Bridge to load the plugin");
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstallingId(null);
    }
  };

  const handleBuy = async (
    entry: CatalogEntry,
    provider: "stripe" | "paypal" | "crypto"
  ) => {
    setBuyingId(entry.id);
    try {
      await acceptMarketplaceTos();
      setTosAccepted(true);
      const origin = window.location.origin;
      const result = await startMarketplaceCheckout({
        provider,
        catalogEntryId: entry.id,
        listingId: entry.listingId,
        successUrl: `${origin}/marketplace?paid=1&tab=official&entry=${encodeURIComponent(entry.id)}`,
        cancelUrl: `${origin}/marketplace?canceled=1&tab=official`,
      });
      if (result.checkout.url) {
        window.location.href = result.checkout.url;
        return;
      }
      if (result.checkout.crypto) {
        setCryptoPrompt({
          orderId: result.checkout.crypto.orderId,
          treasuryAddress: result.checkout.crypto.treasuryAddress,
          amountCents: result.checkout.crypto.amountCents,
          asset: result.checkout.crypto.asset,
          chainId: result.checkout.crypto.chainId,
        });
        toast.message("Send crypto to the treasury address, then paste the tx hash.");
        return;
      }
      toast.success("Order ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBuyingId(null);
    }
  };

  const handleCommunityBuy = async (
    listing: MarketplaceListing,
    provider: "stripe" | "paypal" | "crypto"
  ) => {
    setBuyingId(listing.id);
    try {
      await acceptMarketplaceTos();
      setTosAccepted(true);
      const origin = window.location.origin;
      const result = await startMarketplaceCheckout(
        communityCheckoutBody({
          listingId: listing.id,
          provider,
          successUrl: `${origin}/marketplace?paid=1&tab=community&listing=${encodeURIComponent(listing.id)}`,
          cancelUrl: `${origin}/marketplace?canceled=1&tab=community`,
        })
      );
      if (result.checkout.url) {
        window.location.href = result.checkout.url;
        return;
      }
      if (result.checkout.crypto) {
        setCryptoPrompt({
          orderId: result.checkout.crypto.orderId,
          treasuryAddress: result.checkout.crypto.treasuryAddress,
          amountCents: result.checkout.crypto.amountCents,
          asset: result.checkout.crypto.asset,
          chainId: result.checkout.crypto.chainId,
        });
        toast.message("Send crypto to the treasury address, then paste the tx hash.");
        return;
      }
      toast.success("Order ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBuyingId(null);
    }
  };

  const handleAcquireListing = async (listing: MarketplaceListing) => {
    setAcquiringId(listing.id);
    try {
      const result = await acquireMarketplaceListing(listing.id);
      toast.success(
        result.mode === "live"
          ? "Live entitlement granted"
          : `Imported ${result.import?.kind ?? "item"}`
      );
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Acquire failed");
    } finally {
      setAcquiringId(null);
    }
  };

  const handleConfirmCrypto = async () => {
    if (!cryptoPrompt || !cryptoTxHash.trim()) return;
    try {
      await confirmMarketplaceCryptoPayment(cryptoPrompt.orderId, cryptoTxHash.trim());
      toast.success("Payment recorded — you can install or acquire now");
      setCryptoPrompt(null);
      setCryptoTxHash("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not confirm payment");
    }
  };

  const handleAcceptTos = async () => {
    try {
      const result = await acceptMarketplaceTos();
      setTosVersion(result.tosVersion);
      setTosAccepted(true);
      toast.success(`Accepted Marketplace ToS v${result.tosVersion}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ToS acceptance failed");
    }
  };

  const publishPriceCents = Math.round(Number(publishPriceDollars || "0") * 100);
  const canPublishPaid = publishPriceCents <= 0 || payoutReady;
  const canPublish =
    tosAccepted &&
    canPublishPaid &&
    publishTitle.trim().length > 0 &&
    publishResourceId.trim().length > 0;

  const handlePublish = async () => {
    if (!canPublish) return;
    setPublishing(true);
    try {
      await createMarketplaceListing({
        kind: publishKind,
        title: publishTitle.trim(),
        description: publishDescription.trim() || undefined,
        priceCents: publishPriceCents,
        deliveryMode: publishDelivery,
        resourceId: publishResourceId.trim() || undefined,
        sellerKind: "user",
      });
      toast.success("Listing published");
      setPublishTitle("");
      setPublishDescription("");
      setPublishPriceDollars("0");
      setPublishResourceId("");
      await reload();
      handleTabChange("community");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  const handleArchive = async (listingId: string) => {
    try {
      await archiveMarketplaceListing(listingId);
      toast.success("Listing archived");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed");
    }
  };

  const handleAddLocalPlugin = async () => {
    if (!localPath.trim()) return;
    setAddingLocal(true);
    try {
      const result = await registerLocalPlugin(localPath.trim());
      toast.success(`Added ${result.name}`);
      setLocalPath("");
      reloadAfterPluginChange(result.built);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add local plugin");
    } finally {
      setAddingLocal(false);
    }
  };

  const handleInstallDiscovered = async (pluginId: string) => {
    setBusyPluginId(pluginId);
    try {
      await installWorkspacePlugin(pluginId);
      toast.success("Plugin installed for this workspace");
      reloadAfterPluginChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Install failed");
    } finally {
      setBusyPluginId(null);
    }
  };

  const handleUninstallDiscovered = async (pluginId: string) => {
    setBusyPluginId(pluginId);
    try {
      await uninstallWorkspacePlugin(pluginId);
      toast.success("Plugin uninstalled from this workspace");
      reloadAfterPluginChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Uninstall failed");
    } finally {
      setBusyPluginId(null);
    }
  };

  const handleRemoveLocalPath = async (pluginRoot: string) => {
    setBusyPluginId(pluginRoot);
    try {
      await removeLocalPlugin(pluginRoot);
      toast.success("Removed local plugin path");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove path");
    } finally {
      setBusyPluginId(null);
    }
  };

  const handleAddSource = async () => {
    if (!sourceName.trim() || !sourceUrl.trim()) return;
    try {
      await addCatalogSource(sourceName.trim(), sourceUrl.trim());
      setSourceName("");
      setSourceUrl("");
      await reload();
      toast.success("Catalog source added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add source");
    }
  };

  const feePercent = (platformFeeBps / 100).toFixed(0);

  return (
    <Page>
      <PageHeader
        title="Marketplace"
        description="Official is ReBotics-curated. Community is the user seller path (Sell tab + gated community catalog). Paid Official goes 100% to ReBotics; Community sales take a 10% platform fee. Chargebacks ban Marketplace access."
        actions={
          <Button variant="outline" size="sm" render={<a href={OFFICIAL_REPO} target="_blank" rel="noreferrer" />}>
            Community catalog PRs
          </Button>
        }
      />

      {cryptoPrompt ? (
        <Card className="mb-4 border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-base">Complete crypto payment</CardTitle>
            <CardDescription>
              Send {(cryptoPrompt.amountCents / 100).toFixed(2)} {cryptoPrompt.asset} (chain{" "}
              {cryptoPrompt.chainId}) to {cryptoPrompt.treasuryAddress}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={cryptoTxHash}
              onChange={(e) => setCryptoTxHash(e.target.value)}
              placeholder="0x… transaction hash"
            />
            <Button onClick={() => void handleConfirmCrypto()}>Confirm payment</Button>
            <Button variant="ghost" onClick={() => setCryptoPrompt(null)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 flex gap-2">
        <Input
          placeholder="Search listings and plugins…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => void reload()}>
          Refresh
        </Button>
      </div>

      <Tabs value={tab === "local" && !showLocalTab ? "official" : tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="official">Official</TabsTrigger>
          {showLocalTab ? <TabsTrigger value="local">Local</TabsTrigger> : null}
          <TabsTrigger value="community">Community</TabsTrigger>
          <TabsTrigger value="installed">Installed</TabsTrigger>
          <TabsTrigger value="seller">Sell</TabsTrigger>
        </TabsList>

        <TabsContent value="official" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading official catalog…</p>
          ) : officialFiltered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {officialCatalogEmptyMessage(saas === true)}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {officialFiltered.map((entry) => (
                <EntryCard
                  key={`official-${entry.id}`}
                  entry={entry}
                  installed={installedIds.has(entry.id)}
                  installing={installingId === entry.id}
                  buying={buyingId === entry.id}
                  onInstall={() => void handleInstall(entry)}
                  onBuy={(provider) => void handleBuy(entry, provider)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {showLocalTab ? (
        <TabsContent value="local" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add local plugin folder</CardTitle>
              <CardDescription>
                Point at a cloned plugin repo on your machine. GodMode validates{" "}
                <code className="text-xs">godmode.plugin.json</code>, builds if needed, registers
                the plugin with Bridge, and installs it for this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-1">
                <Label htmlFor="local-plugin-path">Folder path</Label>
                <Input
                  id="local-plugin-path"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="C:\Users\you\Desktop\my-godmode-plugin"
                />
              </div>
              <Button
                className="sm:self-end"
                disabled={addingLocal || !localPath.trim()}
                onClick={() => void handleAddLocalPlugin()}
              >
                <FolderOpenIcon data-icon="inline-start" className="size-4" />
                {addingLocal ? "Adding…" : "Add & install"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add catalog source</CardTitle>
              <CardDescription>
                Browse third-party packs from a remote or local catalog index. Local catalogs use a{" "}
                <code className="text-xs">file:///</code> URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Catalog URL</Label>
                <Input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="file:///C:/Users/you/my-catalog/catalog/index.json"
                />
              </div>
              <Button className="sm:col-span-2 w-fit" onClick={() => void handleAddSource()}>
                Add source
              </Button>
            </CardContent>
          </Card>

          {sources.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Your catalog sources</p>
              {sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {s.name} · <span className="text-muted-foreground">{s.url}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void removeCatalogSource(s.id).then(() => reload())
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {discoveredFiltered.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Plugins on this machine</p>
              <ul className="space-y-2">
                {discoveredFiltered.map((plugin) => (
                  <DiscoveredPluginRow
                    key={plugin.id}
                    plugin={plugin}
                    busy={busyPluginId === plugin.id || busyPluginId === plugin.pluginRoot}
                    onInstall={() => void handleInstallDiscovered(plugin.id)}
                    onUninstall={() => void handleUninstallDiscovered(plugin.id)}
                    onRemovePath={
                      plugin.source === "marketplace"
                        ? () => void handleRemoveLocalPath(plugin.pluginRoot)
                        : undefined
                    }
                  />
                ))}
              </ul>
              {localPaths.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {localPaths.length} folder{localPaths.length === 1 ? "" : "s"} registered via
                  Marketplace.
                </p>
              ) : null}
            </div>
          ) : !loading ? (
            <p className="text-sm text-muted-foreground">
              No plugins discovered yet. Add a local folder above or a catalog source with{" "}
              <code className="text-xs">pluginLocalPath</code> entries.
            </p>
          ) : null}

          {localFiltered.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">From local catalogs</p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {localFiltered.map((entry) => (
                  <EntryCard
                    key={`local-${entry.id}-${entry.sourceCatalog}`}
                    entry={entry}
                    installed={installedIds.has(entry.id)}
                    installing={installingId === entry.id}
                    buying={false}
                    onInstall={() => void handleInstall(entry)}
                    onBuy={() => undefined}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </TabsContent>
        ) : null}

        <TabsContent value="community" className="mt-4 space-y-6">
          <p className="text-sm text-muted-foreground">
            User-to-user marketplace. Gated plugins land in the Community catalog (CI + pins).
            Portable listings publish from the Sell tab. Official stays ReBotics-only.
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading community catalog…</p>
          ) : communityCatalogFiltered.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Community catalog</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {communityCatalogFiltered.map((entry) => (
                  <EntryCard
                    key={`community-cat-${entry.id}`}
                    entry={entry}
                    installed={installedIds.has(entry.id)}
                    installing={installingId === entry.id}
                    buying={buyingId === entry.id}
                    onInstall={() => void handleInstall(entry)}
                    onBuy={(provider) => void handleBuy(entry, provider)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {entitlements.filter((e) => e.status === "active").length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your purchases</CardTitle>
                <CardDescription>
                  Live entitlements from Community (and other) listings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {entitlements
                    .filter((e) => e.status === "active")
                    .map((e) => (
                      <li key={e.id} className="rounded-md border px-3 py-2">
                        <span className="font-medium">
                          {e.listing_title ?? e.kind}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {e.delivery_mode ?? "live"} · {e.pricing_model}
                        </span>
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading community listings…</p>
          ) : communityFiltered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No community listings yet — publish from Sell.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {communityFiltered.map((listing) => (
                <CommunityListingCard
                  key={listing.id}
                  listing={listing}
                  owned={ownedListingIds.has(listing.id)}
                  busy={buyingId === listing.id || acquiringId === listing.id}
                  onAcquire={() => void handleAcquireListing(listing)}
                  onBuy={(provider) => void handleCommunityBuy(listing, provider)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="installed" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workspace plugins</CardTitle>
              <CardDescription>
                {showLocalTab
                  ? "Domain packs enabled for this workspace. Uninstall removes sidebar structure and tenant hooks; local folders stay registered until you remove the path."
                  : "Domain packs enabled for this workspace. Uninstall removes sidebar structure and tenant hooks."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenantPlugins.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {installedEmptyHint(!showLocalTab)}
                </p>
              ) : (
                <ul className="space-y-2">
                  {tenantPlugins.map((row) => {
                    const installRoot = (row.plugin_root ?? "").replace(/\\/g, "/");
                    const meta = discovered.find((p) => {
                      if (p.id !== row.plugin_id) return false;
                      if (!installRoot) return true;
                      return p.pluginRoot.replace(/\\/g, "/") === installRoot;
                    });
                    return (
                      <DiscoveredPluginRow
                        key={row.plugin_id}
                        plugin={
                          meta
                            ? { ...meta, pluginRoot: row.plugin_root || meta.pluginRoot }
                            : {
                                id: row.plugin_id,
                                name: row.plugin_id,
                                version: row.version,
                                pluginRoot: row.plugin_root ?? "",
                                loaded: false,
                                installed: true,
                                source: "marketplace",
                              }
                        }
                        busy={busyPluginId === row.plugin_id}
                        onInstall={() => void handleInstallDiscovered(row.plugin_id)}
                        onUninstall={() => void handleUninstallDiscovered(row.plugin_id)}
                        onRemovePath={
                          meta?.source === "marketplace" &&
                          meta.pluginRoot &&
                          !/marketplace-plugins[\\/]/i.test(meta.pluginRoot)
                            ? () => void handleRemoveLocalPath(meta.pluginRoot)
                            : undefined
                        }
                      />
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {catalogInstalls.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Install history</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {catalogInstalls.map((row) => (
                    <li key={String(row.id)} className="rounded-md border px-3 py-2">
                      <span className="font-medium">{String(row.entry_title)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {String(row.install_type)} · {String(row.installed_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="seller" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Marketplace Terms</CardTitle>
              <CardDescription>
                Official sales and delivered digital goods are final. Community disputes are between
                buyer and seller via the payment processor; failed access provisioning goes to
                support@godmode.software. A chargeback or payment dispute after delivery results in a
                permanent Marketplace ban (no buying or earning). Current ToS version: {tosVersion}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void handleAcceptTos()}>Accept Marketplace ToS</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <StoreIcon className="size-4" />
                Seller payouts
              </CardTitle>
              <CardDescription>
                Connect Stripe for Community sales under Personal Vault → Marketplace.
                {payoutReady
                  ? " A payout method is connected."
                  : " Paid listings need a connected payout first."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to={`${VAULT_PATH}?tab=marketplace`}
                className={buttonVariants({ variant: "outline" })}
              >
                Manage in Personal Vault → Marketplace
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publish listing</CardTitle>
              <CardDescription>
                List a skill, agent, page, or other portable entity for Community. Free listings need
                ToS only; paid listings need a connected payout ({feePercent}% platform fee).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {!tosAccepted ? (
                <p className="text-sm text-amber-700 sm:col-span-2">
                  Accept Marketplace ToS before publishing.
                </p>
              ) : null}
              {publishPriceCents > 0 && !payoutReady ? (
                <p className="text-sm text-amber-700 sm:col-span-2">
                  Connect a payout method before publishing a paid listing.
                </p>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor="publish-kind">Kind</Label>
                <select
                  id="publish-kind"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={publishKind}
                  onChange={(e) => setPublishKind(e.target.value)}
                >
                  {LISTING_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="publish-delivery">Delivery</Label>
                <select
                  id="publish-delivery"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={publishDelivery}
                  onChange={(e) =>
                    setPublishDelivery(e.target.value === "live" ? "live" : "clone")
                  }
                >
                  <option value="clone">clone (import copy)</option>
                  <option value="live">live (shared entitlement)</option>
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="publish-title">Title</Label>
                <Input
                  id="publish-title"
                  value={publishTitle}
                  onChange={(e) => setPublishTitle(e.target.value)}
                  placeholder="My skill pack"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="publish-desc">Description</Label>
                <Input
                  id="publish-desc"
                  value={publishDescription}
                  onChange={(e) => setPublishDescription(e.target.value)}
                  placeholder="What buyers get"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="publish-price">Price (USD)</Label>
                <Input
                  id="publish-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={publishPriceDollars}
                  onChange={(e) => setPublishPriceDollars(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="publish-resource">Source resource id</Label>
                <Input
                  id="publish-resource"
                  value={publishResourceId}
                  onChange={(e) => setPublishResourceId(e.target.value)}
                  placeholder="Entity id to clone or share"
                />
              </div>
              <Button
                className="w-fit"
                disabled={!canPublish || publishing}
                onClick={() => void handlePublish()}
              >
                {publishing ? "Publishing…" : "Publish to Community"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">My listings</CardTitle>
              <CardDescription>Active listings you published. Archive removes them from Community.</CardDescription>
            </CardHeader>
            <CardContent>
              {myListings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active listings yet.</p>
              ) : (
                <ul className="space-y-2">
                  {myListings.map((listing) => (
                    <li
                      key={listing.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="font-medium">{listing.title}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {listing.kind} · {listing.delivery_mode ?? "clone"} ·{" "}
                          {formatMarketplaceCents(listing.price_cents)} · {listing.status}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleArchive(listing.id)}
                      >
                        Archive
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
