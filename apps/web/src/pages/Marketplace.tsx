import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  acceptMarketplaceTos,
  acquireMarketplaceListing,
  addCatalogSource,
  archiveMarketplaceListing,
  confirmMarketplaceCryptoPayment,
  createMarketplaceListing,
  bindMarketplaceLiveListing,
  fetchInstalledCatalog,
  fetchMarketplaceCommerceConfig,
  fetchMarketplaceEntitlements,
  fetchMarketplaceListings,
  fetchMyMarketplaceListings,
  fetchOfficialCatalog,
  fetchCommunityCatalog,
  prepareCommunityCatalogSubmission,
  submitCommunityCatalogSubmission,
  fetchUnofficialCatalog,
  fetchBridgeHealth,
  fetchInferenceEndpoints,
  installCatalogEntry,
  installWorkspacePlugin,
  registerLocalPlugin,
  removeCatalogSource,
  removeLocalPlugin,
  startCloudMarketplaceCheckout,
  completeCloudMarketplaceCheckout,
  startMarketplaceCheckout,
  confirmMarketplaceStripeSession,
  uninstallWorkspacePlugin,
  type CatalogEntry,
  type CommunityCatalogSubmissionPrepareResult,
  type DiscoveredPlugin,
  type InferenceEndpoint,
  type MarketplaceEntitlement,
  type MarketplaceListing,
  type TenantPluginRow,
} from "@/api";
import {
  communityCheckoutBody,
  formatMarketplaceCents,
  installedEmptyHint,
  listingStatusLabel,
  marketplaceCloudCommunityUrl,
  marketplaceCloudSellUrl,
  marketplaceSellerStorefrontUrl,
  marketplaceShowsLocalTab,
  normalizeMarketplaceTab,
  officialCatalogEmptyMessage,
  sellerPayoutStatusFromAccount,
  userFacingErrorMessage,
  CLONE_PACK_KINDS,
  type PublishFamily,
} from "@/lib/marketplace-format";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { MarketplaceTosDialog } from "@/pages/MarketplaceTosDialog";
import { CloudSellerLinkApproveCard, LocalSellerLinkCard } from "@/pages/SellerLinkCards";

const OFFICIAL_REPO =
  "https://github.com/ReBoticsAI/GodMode-Marketplace/blob/main/CONTRIBUTING.md";

const LISTING_KINDS = CLONE_PACK_KINDS;

function sellerOwnsCatalogEntryClient(
  entry: { author?: string; pluginRepo?: string },
  githubLogin: string | null | undefined
): boolean {
  const login = String(githubLogin ?? "").trim().toLowerCase();
  if (!login) return false;
  const author = String(entry.author ?? "").trim().toLowerCase();
  if (
    author &&
    (author === login || author.endsWith(`/${login}`) || author.startsWith(`${login}/`))
  ) {
    return true;
  }
  const repo = String(entry.pluginRepo ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return Boolean(repo && (repo === login || repo.startsWith(`${login}/`)));
}

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

function listingIsCloudHosted(listing: MarketplaceListing): boolean {
  return String(listing.commerce_host ?? "").toLowerCase() === "cloud";
}

function CommunityListingCard({
  listing,
  owned,
  onAcquire,
  onBuy,
  busy,
  guestBuy,
}: {
  listing: MarketplaceListing;
  owned: boolean;
  onAcquire: () => void;
  onBuy: (provider: "stripe" | "paypal" | "crypto") => void;
  busy: boolean;
  guestBuy: boolean;
}) {
  const paid = Number(listing.price_cents ?? 0) > 0;
  const cloudHosted = listingIsCloudHosted(listing);
  const live = String(listing.delivery_mode ?? "clone").toLowerCase() === "live";
  const openOnCloud = cloudHosted && live;
  const sellerStorefront = marketplaceSellerStorefrontUrl(
    String(listing.seller_public_handle ?? "")
  );
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
                {cloudHosted ? <Badge variant="outline">GodMode Cloud</Badge> : null}
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
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {listing.description?.trim() || "No description"}
        </p>
        {openOnCloud ? (
          <Button
            size="sm"
            render={<a href={marketplaceCloudCommunityUrl()} target="_blank" rel="noreferrer" />}
          >
            Open on GodMode Cloud
          </Button>
        ) : paid && !owned ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onBuy("stripe")} disabled={busy}>
              {busy ? "Starting…" : guestBuy ? "Buy on Stripe" : "Buy (Card)"}
            </Button>
            {guestBuy ? null : (
              <>
                <Button size="sm" variant="outline" onClick={() => onBuy("paypal")} disabled={busy}>
                  PayPal
                </Button>
                <Button size="sm" variant="outline" onClick={() => onBuy("crypto")} disabled={busy}>
                  Crypto
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={onAcquire} disabled={busy}>
              Acquire if owned
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={onAcquire} disabled={busy || owned}>
            {owned ? "Owned" : busy ? "Acquiring…" : "Acquire"}
          </Button>
        )}
        {sellerStorefront ? (
          <Button
            size="sm"
            variant="link"
            className="h-auto w-fit px-0"
            render={<a href={sellerStorefront} target="_blank" rel="noreferrer" />}
          >
            More from this seller
          </Button>
        ) : null}
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
  // Local Buy gates on ToS before proxying to Cloud; persist acknowledgment on this browser
  // because Local has no Cloud seller-account commerce_config row to hydrate from.
  const [tosAccepted, setTosAccepted] = useState(() => {
    try {
      return localStorage.getItem("godmode.marketplace.tosAccepted") === "1";
    } catch {
      return false;
    }
  });
  const [tosDialogOpen, setTosDialogOpen] = useState(false);
  const [tosAccepting, setTosAccepting] = useState(false);
  const [sellerLinkApproveCode, setSellerLinkApproveCode] = useState<string | null>(null);
  const [payoutReady, setPayoutReady] = useState(false);
  const [stripeConnectLinked, setStripeConnectLinked] = useState(false);
  const [stripeConnectAttested, setStripeConnectAttested] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishKind, setPublishKind] = useState<string>("skill");
  const [publishTitle, setPublishTitle] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishPriceDollars, setPublishPriceDollars] = useState("0");
  const [publishResourceId, setPublishResourceId] = useState("");
  const [publishFamily, setPublishFamily] = useState<PublishFamily>("plugin");
  const [publishCatalogEntryId, setPublishCatalogEntryId] = useState("");
  const [catalogOrphans, setCatalogOrphans] = useState<
    Array<{ id: string; title: string; author: string; priceCents: number }>
  >([]);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [inferenceEndpoints, setInferenceEndpoints] = useState<InferenceEndpoint[]>([]);
  const [catalogSubmitInstallType, setCatalogSubmitInstallType] = useState<"plugin" | "clone">(
    "plugin"
  );
  const [catalogSubmitId, setCatalogSubmitId] = useState("");
  const [catalogSubmitTitle, setCatalogSubmitTitle] = useState("");
  const [catalogSubmitDescription, setCatalogSubmitDescription] = useState("");
  const [catalogSubmitKind, setCatalogSubmitKind] = useState("skill");
  const [catalogSubmitPluginRepo, setCatalogSubmitPluginRepo] = useState("");
  const [catalogSubmitPluginRef, setCatalogSubmitPluginRef] = useState("");
  const [catalogSubmitBundlePath, setCatalogSubmitBundlePath] = useState("bundle.json");
  const [catalogSubmitCiRunUrl, setCatalogSubmitCiRunUrl] = useState("");
  const [catalogSubmitDeliveryMode, setCatalogSubmitDeliveryMode] = useState<"clone" | "live">(
    "clone"
  );
  const [catalogSubmitPreview, setCatalogSubmitPreview] =
    useState<CommunityCatalogSubmissionPrepareResult | null>(null);
  const [catalogSubmitBusy, setCatalogSubmitBusy] = useState(false);

  const catalogSubmitBody = useMemo(
    () => ({
      id: catalogSubmitId.trim(),
      title: catalogSubmitTitle.trim(),
      description: catalogSubmitDescription.trim(),
      installType: catalogSubmitInstallType,
      kind: catalogSubmitInstallType === "clone" ? catalogSubmitKind : undefined,
      pluginRepo: catalogSubmitPluginRepo.trim() || undefined,
      pluginRef: catalogSubmitPluginRef.trim() || undefined,
      bundlePath:
        catalogSubmitInstallType === "clone"
          ? catalogSubmitBundlePath.trim() || undefined
          : undefined,
      ciRunUrl:
        catalogSubmitInstallType === "plugin" ? catalogSubmitCiRunUrl.trim() || undefined : undefined,
      deliveryMode:
        catalogSubmitInstallType === "clone" ? catalogSubmitDeliveryMode : undefined,
      stripeConnectAttestation: stripeConnectLinked ? stripeConnectAttested : undefined,
    }),
    [
      catalogSubmitId,
      catalogSubmitTitle,
      catalogSubmitDescription,
      catalogSubmitInstallType,
      catalogSubmitKind,
      catalogSubmitPluginRepo,
      catalogSubmitPluginRef,
      catalogSubmitBundlePath,
      catalogSubmitCiRunUrl,
      catalogSubmitDeliveryMode,
      stripeConnectLinked,
      stripeConnectAttested,
    ]
  );

  const handleCatalogSubmitPreview = async () => {
    setCatalogSubmitBusy(true);
    try {
      const result = await prepareCommunityCatalogSubmission(catalogSubmitBody);
      setCatalogSubmitPreview(result);
      if (result.blockers.length) {
        toast.message("Manifest preview ready", {
          description: `${result.blockers.length} blocker(s) before PR submit.`,
        });
      } else {
        toast.success("Ready to open a Community catalog PR");
      }
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Could not prepare catalog submission"));
    } finally {
      setCatalogSubmitBusy(false);
    }
  };

  const handleCatalogSubmitPr = async () => {
    setCatalogSubmitBusy(true);
    try {
      const result = await submitCommunityCatalogSubmission(catalogSubmitBody);
      toast.success(`Opened PR #${result.prNumber}`);
      setPublishCatalogEntryId(result.catalogEntryId);
      setCatalogSubmitPreview(null);
      window.open(result.prUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Could not submit catalog PR"));
    } finally {
      setCatalogSubmitBusy(false);
    }
  };

  useEffect(() => {
    void fetchBridgeHealth()
      .then((h) => setSaas(Boolean(h.saas)))
      .catch(() => setSaas(false));
  }, []);

  useEffect(() => {
    if (saas === true && publishFamily === "inference") {
      setPublishFamily("plugin");
    }
  }, [saas, publishFamily]);

  const ownedListingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entitlements) {
      if (e.status === "active" || e.status === "cancelled") ids.add(e.listing_id);
    }
    return ids;
  }, [entitlements]);

  const reload = useCallback(async () => {
    setLoading(true);
    const emptyUnofficial = {
      sources: [] as Array<{ id: string; name: string; url: string; created_at: string }>,
      entries: [] as CatalogEntry[],
      discovered: [] as DiscoveredPlugin[],
      localPaths: [] as string[],
    };
    try {
      const showLocal = marketplaceShowsLocalTab(saas);
      const [off, local, inst, community, communityCat, mine, ents, inf] = await Promise.all([
        fetchOfficialCatalog().catch((err) => {
          toast.error(userFacingErrorMessage(err, "Failed to load Official catalog"));
          return { entries: [] as CatalogEntry[] };
        }),
        showLocal
          ? fetchUnofficialCatalog().catch((err) => {
              toast.error(userFacingErrorMessage(err, "Failed to load Local catalog"));
              return emptyUnofficial;
            })
          : Promise.resolve(emptyUnofficial),
        fetchInstalledCatalog().catch((err) => {
          toast.error(userFacingErrorMessage(err, "Failed to load installed plugins"));
          return {
            catalogInstalls: [] as Array<Record<string, unknown>>,
            plugins: [] as TenantPluginRow[],
            available: [] as DiscoveredPlugin[],
            discovered: [] as DiscoveredPlugin[],
          };
        }),
        fetchMarketplaceListings({ sellerKind: "user" }).catch((err) => {
          toast.error(userFacingErrorMessage(err, "Failed to load Community listings"));
          return { listings: [] };
        }),
        fetchCommunityCatalog().catch((err) => {
          toast.error(userFacingErrorMessage(err, "Failed to load Community catalog"));
          return { catalogUrl: "", entries: [] as CatalogEntry[] };
        }),
        fetchMyMarketplaceListings().catch(() => ({
          listings: [] as MarketplaceListing[],
          catalogOrphans: [],
          githubLogin: null,
        })),
        fetchMarketplaceEntitlements().catch(() => ({ entitlements: [] })),
        fetchInferenceEndpoints().catch(() => ({ endpoints: [] as InferenceEndpoint[] })),
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
      setCatalogOrphans(mine.catalogOrphans ?? []);
      setGithubLogin(mine.githubLogin ?? null);
      setEntitlements(ents.entitlements);
      setInferenceEndpoints(inf.endpoints);
      const ids = new Set((inst.plugins ?? []).map((p) => p.plugin_id));
      setInstalledIds(ids);
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Failed to load marketplace"));
    } finally {
      setLoading(false);
    }
  }, [saas]);

  useEffect(() => {
    void reload();
    void fetchMarketplaceCommerceConfig()
      .then((cfg) => {
        setTosVersion(cfg.tosVersion);
        setPlatformFeeBps(cfg.platformFeeBps);
        setTosAccepted(Boolean(cfg.tosAccepted));
        setPayoutReady(sellerPayoutStatusFromAccount(cfg).payoutReady);
        setStripeConnectLinked(Boolean(String(cfg.stripeConnectAccountId ?? "").trim()));
      })
      .catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    const code = searchParams.get("seller_link");
    if (code && saas === true) {
      setSellerLinkApproveCode(code.trim().toUpperCase());
      if (tab !== "seller") {
        const next = new URLSearchParams(searchParams);
        next.set("tab", "seller");
        setSearchParams(next, { replace: true });
      }
    }
  }, [saas, searchParams, setSearchParams, tab]);

  useEffect(() => {
    const paid = searchParams.get("paid");
    const canceled = searchParams.get("canceled");
    const sessionId = searchParams.get("session_id");
    if (paid === "1" && sessionId && saas !== true) {
      const next = new URLSearchParams(searchParams);
      next.delete("paid");
      next.delete("entry");
      next.delete("listing");
      next.delete("session_id");
      setSearchParams(next, { replace: true });
      void completeCloudMarketplaceCheckout(sessionId)
        .then(() => {
          toast.success("Payment complete. Installed on this machine.");
          void reload();
        })
        .catch((err) => {
          toast.error(userFacingErrorMessage(err, "Paid session could not be delivered"));
        });
      return;
    }
    if (paid === "1" && sessionId && saas === true) {
      const next = new URLSearchParams(searchParams);
      next.delete("paid");
      next.delete("entry");
      next.delete("listing");
      next.delete("session_id");
      setSearchParams(next, { replace: true });
      void confirmMarketplaceStripeSession(sessionId)
        .then(() => {
          toast.success("Payment complete. Install or acquire your purchase.");
          void reload();
        })
        .catch((err) => {
          toast.error(userFacingErrorMessage(err, "Paid session could not be confirmed"));
          void reload();
        });
      return;
    }
    if (paid === "1") {
      toast.success("Payment complete. Install or acquire your purchase.");
      const next = new URLSearchParams(searchParams);
      next.delete("paid");
      next.delete("entry");
      next.delete("listing");
      next.delete("session_id");
      setSearchParams(next, { replace: true });
      void reload();
    } else if (canceled === "1") {
      toast.message("Checkout canceled");
      const next = new URLSearchParams(searchParams);
      next.delete("canceled");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, reload, saas]);

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

  const ownedCommunityCatalog = useMemo(
    () =>
      communityCatalog.filter((entry) => sellerOwnsCatalogEntryClient(entry, githubLogin)),
    [communityCatalog, githubLogin]
  );

  const ownedCatalogForFamily = useMemo(() => {
    if (publishFamily === "plugin") {
      return ownedCommunityCatalog.filter((e) => e.installType !== "clone");
    }
    if (publishFamily === "clone") {
      return ownedCommunityCatalog.filter(
        (e) => e.installType === "clone" && e.deliveryMode !== "live"
      );
    }
    if (publishFamily === "live") {
      return ownedCommunityCatalog.filter(
        (e) => e.installType === "clone" && e.deliveryMode === "live"
      );
    }
    return ownedCommunityCatalog;
  }, [ownedCommunityCatalog, publishFamily]);

  const selectedPublishCatalogEntry = useMemo(
    () => ownedCatalogForFamily.find((e) => e.id === publishCatalogEntryId) ?? null,
    [ownedCatalogForFamily, publishCatalogEntryId]
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
      toast.error(userFacingErrorMessage(err, "Install failed"));
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
        successUrl: `${origin}/marketplace?paid=1&session_id={CHECKOUT_SESSION_ID}&tab=official&entry=${encodeURIComponent(entry.id)}`,
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
      toast.error(userFacingErrorMessage(err, "Checkout failed"));
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
      if (saas !== true) {
        if (provider !== "stripe") {
          toast.error("Local Buy against Cloud uses Stripe. PayPal and crypto stay deferred.");
          return;
        }
        if (!tosAccepted) {
          setTosDialogOpen(true);
          toast.message("Accept Marketplace Terms, then buy again.");
          return;
        }
        const origin = window.location.origin;
        const result = await startCloudMarketplaceCheckout({
          listingId: listing.id,
          successUrl: `${origin}/marketplace?paid=1&session_id={CHECKOUT_SESSION_ID}&tab=community`,
          cancelUrl: `${origin}/marketplace?canceled=1&tab=community`,
          tosAccepted: true,
        });
        if (result.url) {
          window.location.href = result.url;
          return;
        }
        toast.error("Stripe Checkout did not return a URL");
        return;
      }
      await acceptMarketplaceTos();
      setTosAccepted(true);
      const origin = window.location.origin;
      const result = await startMarketplaceCheckout(
        communityCheckoutBody({
          listingId: listing.id,
          provider,
          successUrl: `${origin}/marketplace?paid=1&session_id={CHECKOUT_SESSION_ID}&tab=community&listing=${encodeURIComponent(listing.id)}`,
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
      toast.error(userFacingErrorMessage(err, "Checkout failed"));
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
      toast.error(userFacingErrorMessage(err, "Acquire failed"));
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
      toast.error(userFacingErrorMessage(err, "Could not confirm payment"));
    }
  };

  const handleAcceptTos = async () => {
    setTosAccepting(true);
    try {
      if (saas !== true) {
        try {
          localStorage.setItem("godmode.marketplace.tosAccepted", "1");
        } catch {
          /* ignore quota / private mode */
        }
        setTosAccepted(true);
        setTosDialogOpen(false);
        toast.success(`Accepted Marketplace ToS v${tosVersion}`);
        return;
      }
      const result = await acceptMarketplaceTos();
      setTosVersion(result.tosVersion);
      setTosAccepted(true);
      setTosDialogOpen(false);
      toast.success(`Accepted Marketplace ToS v${result.tosVersion}`);
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "ToS acceptance failed"));
    } finally {
      setTosAccepting(false);
    }
  };

  const publishPriceCents = Math.round(Number(publishPriceDollars || "0") * 100);
  const connectAttestationOk = !stripeConnectLinked || stripeConnectAttested;
  const canPublishPaid =
    publishPriceCents <= 0 ||
    payoutReady ||
    publishFamily === "plugin" ||
    publishFamily === "clone" ||
    publishFamily === "live";
  const canPublish = (() => {
    if (!tosAccepted) return false;
    if (!connectAttestationOk) return false;
    if (!canPublishPaid) return false;
    if (!publishTitle.trim()) return false;
    if (publishFamily === "plugin" || publishFamily === "clone") {
      return Boolean(publishCatalogEntryId.trim() && selectedPublishCatalogEntry);
    }
    if (publishFamily === "live") {
      return Boolean(
        publishCatalogEntryId.trim() &&
          selectedPublishCatalogEntry &&
          publishResourceId.trim()
      );
    }
    if (publishFamily === "inference") return Boolean(publishResourceId.trim());
    return false;
  })();

  const applyCatalogEntryToPublish = (entryId: string) => {
    setPublishCatalogEntryId(entryId);
    const entry = ownedCommunityCatalog.find((e) => e.id === entryId);
    if (!entry) return;
    setPublishTitle(entry.title);
    setPublishDescription(entry.description ?? "");
    if (entry.installType === "clone") {
      setPublishKind(CLONE_PACK_KINDS.includes(entry.kind as never) ? entry.kind : "bundle");
    }
    if (typeof entry.priceCents === "number" && entry.priceCents > 0) {
      setPublishPriceDollars((entry.priceCents / 100).toFixed(2));
    }
  };

  const handlePublish = async () => {
    if (!canPublish) return;
    setPublishing(true);
    try {
      if (publishFamily === "live") {
        await bindMarketplaceLiveListing({
          catalogEntryId: publishCatalogEntryId.trim(),
          resourceId: publishResourceId.trim(),
          kind: publishKind,
          title: publishTitle.trim(),
          description: publishDescription.trim() || undefined,
          priceCents: publishPriceCents,
          stripeConnectAttestation: stripeConnectLinked ? stripeConnectAttested : undefined,
        });
        toast.success("Live Share bound to catalog pin");
      } else {
        const kind =
          publishFamily === "plugin"
            ? "plugin"
            : publishFamily === "inference"
              ? "inference"
              : publishKind;
        const delivery = publishFamily === "inference" ? "live" : "clone";
        await createMarketplaceListing({
          kind,
          title: publishTitle.trim(),
          description: publishDescription.trim() || undefined,
          priceCents: publishPriceCents,
          deliveryMode: delivery,
          resourceId:
            publishFamily === "inference" ? publishResourceId.trim() || undefined : undefined,
          catalogEntryId:
            publishFamily === "plugin" || publishFamily === "clone"
              ? publishCatalogEntryId.trim()
              : undefined,
          inferenceEndpointId:
            publishFamily === "inference" ? publishResourceId.trim() : undefined,
          sellerKind: "user",
          stripeConnectAttestation: stripeConnectLinked ? stripeConnectAttested : undefined,
        });
        toast.success(
          publishFamily === "inference" ? "Listing submitted for review" : "Listing saved"
        );
      }
      setPublishTitle("");
      setPublishDescription("");
      setPublishPriceDollars("0");
      setPublishResourceId("");
      setPublishCatalogEntryId("");
      await reload();
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Publish failed"));
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
      toast.error(userFacingErrorMessage(err, "Archive failed"));
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
      toast.error(userFacingErrorMessage(err, "Failed to add local plugin"));
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
      toast.error(userFacingErrorMessage(err, "Install failed"));
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
      toast.error(userFacingErrorMessage(err, "Uninstall failed"));
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
      toast.error(userFacingErrorMessage(err, "Failed to remove path"));
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
      toast.error(userFacingErrorMessage(err, "Failed to add source"));
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
            User-to-user marketplace. Official and Community catalogs are the same GitHub
            indexes on Local, Hub, and Cloud. Plugins and clone packs install a copy on this
            instance from a GitHub pin. Live share stays on the seller host.
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
                    onBuy={(provider) => {
                      if (!entry.listingId) {
                        toast.error(
                          "This plugin has no seller listing yet. The author must claim it on Sell."
                        );
                        return;
                      }
                      const listing = {
                        id: entry.listingId,
                      } as MarketplaceListing;
                      void handleCommunityBuy(listing, provider);
                    }}
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
                  guestBuy={saas !== true}
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
          {saas !== true ? (
            <>
              <Alert>
                <AlertTitle>Paid listings sell on GodMode Cloud</AlertTitle>
                <AlertDescription>
                  Stripe Connect, catalog claim, and paid checkout live on Cloud. Buyers on this
                  machine pay there and the copy installs here. Open{" "}
                  <a
                    className="underline underline-offset-4"
                    href={marketplaceCloudSellUrl()}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Cloud Sell
                  </a>{" "}
                  to connect payouts and publish Community listings.
                </AlertDescription>
              </Alert>
              <LocalSellerLinkCard />
            </>
          ) : null}
          {saas === true && sellerLinkApproveCode ? (
            <CloudSellerLinkApproveCard
              initialCode={sellerLinkApproveCode}
              onCleared={() => {
                setSellerLinkApproveCode(null);
                const next = new URLSearchParams(searchParams);
                next.delete("seller_link");
                setSearchParams(next, { replace: true });
              }}
            />
          ) : null}
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
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setTosDialogOpen(true)}>
                Read Marketplace Terms
              </Button>
              {tosAccepted ? (
                <Badge variant="secondary">Accepted v{tosVersion}</Badge>
              ) : (
                <Button type="button" onClick={() => setTosDialogOpen(true)}>
                  Accept Marketplace ToS
                </Button>
              )}
            </CardContent>
          </Card>
          {stripeConnectLinked ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stripe Connect attestation</CardTitle>
                <CardDescription>
                  Required while Stripe Connect is linked. Confirms your listings comply with
                  prohibited and restricted categories in Marketplace ToS v{tosVersion}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Field orientation="horizontal">
                  <Checkbox
                    id="stripe-connect-attest"
                    checked={stripeConnectAttested}
                    onCheckedChange={(v) => setStripeConnectAttested(v === true)}
                  />
                  <FieldLabel htmlFor="stripe-connect-attest" className="font-normal">
                    I attest my Community listings comply with Marketplace prohibited and restricted
                    categories (and applicable Stripe restricted-business rules).
                  </FieldLabel>
                </Field>
              </CardContent>
            </Card>
          ) : null}
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

          {saas === true ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Submit to Community catalog</CardTitle>
                <CardDescription>
                  Open a GodMode-Marketplace PR from GodMode. After merge, claim the catalog entry
                  below and set your price. GitHub Connect and Marketplace ToS required.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  {!tosAccepted ? (
                    <Alert>
                      <AlertTitle>Marketplace ToS</AlertTitle>
                      <AlertDescription>Accept Marketplace ToS before catalog submit.</AlertDescription>
                    </Alert>
                  ) : null}
                  <Field>
                    <FieldLabel>Intake type</FieldLabel>
                    <ToggleGroup
                      value={[catalogSubmitInstallType]}
                      onValueChange={(next) => {
                        const value = Array.isArray(next) ? next[0] : next;
                        if (value === "plugin" || value === "clone") setCatalogSubmitInstallType(value);
                      }}
                      variant="outline"
                      size="sm"
                    >
                      <ToggleGroupItem value="plugin">Plugin</ToggleGroupItem>
                      <ToggleGroupItem value="clone">Clone pack</ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="catalog-submit-id">Catalog entry id</FieldLabel>
                    <Input
                      id="catalog-submit-id"
                      value={catalogSubmitId}
                      onChange={(e) => setCatalogSubmitId(e.target.value)}
                      placeholder="my-community-plugin"
                    />
                  </Field>
                  {catalogSubmitInstallType === "clone" ? (
                    <Field>
                      <FieldLabel>Delivery</FieldLabel>
                      <ToggleGroup
                        value={[catalogSubmitDeliveryMode]}
                        onValueChange={(next) => {
                          const value = Array.isArray(next) ? next[0] : next;
                          if (value === "clone" || value === "live") {
                            setCatalogSubmitDeliveryMode(value);
                          }
                        }}
                        variant="outline"
                        size="sm"
                      >
                        <ToggleGroupItem value="clone">Clone pack</ToggleGroupItem>
                        <ToggleGroupItem value="live">Live share</ToggleGroupItem>
                      </ToggleGroup>
                      <FieldDescription>
                        Live share buyers get a grant on your host after you bind a matching resource.
                      </FieldDescription>
                    </Field>
                  ) : null}
                  {catalogSubmitInstallType === "clone" ? (
                    <Field>
                      <FieldLabel>Pack kind</FieldLabel>
                      <Select
                        value={catalogSubmitKind}
                        onValueChange={(v) => setCatalogSubmitKind(String(v))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {CLONE_PACK_KINDS.map((k) => (
                              <SelectItem key={k} value={k}>
                                {k}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor="catalog-submit-title">Title</FieldLabel>
                    <Input
                      id="catalog-submit-title"
                      value={catalogSubmitTitle}
                      onChange={(e) => setCatalogSubmitTitle(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="catalog-submit-desc">Description</FieldLabel>
                    <Input
                      id="catalog-submit-desc"
                      value={catalogSubmitDescription}
                      onChange={(e) => setCatalogSubmitDescription(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="catalog-submit-repo">GitHub repo URL</FieldLabel>
                    <Input
                      id="catalog-submit-repo"
                      value={catalogSubmitPluginRepo}
                      onChange={(e) => setCatalogSubmitPluginRepo(e.target.value)}
                      placeholder="https://github.com/you/your-plugin"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="catalog-submit-ref">Pinned ref (tag or SHA)</FieldLabel>
                    <Input
                      id="catalog-submit-ref"
                      value={catalogSubmitPluginRef}
                      onChange={(e) => setCatalogSubmitPluginRef(e.target.value)}
                      placeholder="v0.1.0 or full commit SHA"
                    />
                  </Field>
                  {catalogSubmitInstallType === "clone" ? (
                    <Field>
                      <FieldLabel htmlFor="catalog-submit-bundle">bundlePath</FieldLabel>
                      <Input
                        id="catalog-submit-bundle"
                        value={catalogSubmitBundlePath}
                        onChange={(e) => setCatalogSubmitBundlePath(e.target.value)}
                        placeholder="bundle.json"
                      />
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="catalog-submit-ci">ciRunUrl</FieldLabel>
                      <Input
                        id="catalog-submit-ci"
                        value={catalogSubmitCiRunUrl}
                        onChange={(e) => setCatalogSubmitCiRunUrl(e.target.value)}
                        placeholder="https://github.com/.../actions/runs/..."
                      />
                      <FieldDescription>
                        Green GitHub Actions run for the pinned pluginRef (Community verify workflow).
                      </FieldDescription>
                    </Field>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={catalogSubmitBusy || !tosAccepted || !connectAttestationOk}
                      onClick={() => void handleCatalogSubmitPreview()}
                    >
                      Preview manifest
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        catalogSubmitBusy ||
                        !tosAccepted ||
                        !connectAttestationOk ||
                        !catalogSubmitPreview?.readyToSubmit
                      }
                      onClick={() => void handleCatalogSubmitPr()}
                    >
                      Open catalog PR
                    </Button>
                  </div>
                  {catalogSubmitPreview ? (
                    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                      {catalogSubmitPreview.blockers.length ? (
                        <ul className="list-disc pl-5 text-muted-foreground">
                          {catalogSubmitPreview.blockers.map((b) => (
                            <li key={b.code}>{b.message}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground">No blockers. Ready to open PR.</p>
                      )}
                      <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(catalogSubmitPreview.entry, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </FieldGroup>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publish listing</CardTitle>
              <CardDescription>
                One listing for every Community item. Pick a Community catalog row you own (after
                catalog PR merge). Submit new entries with Submit to Community catalog above. Paid
                sales use your connected payout ({feePercent}% platform fee).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {!tosAccepted ? (
                  <Alert>
                    <AlertTitle>Marketplace ToS</AlertTitle>
                    <AlertDescription>Accept Marketplace ToS before publishing.</AlertDescription>
                  </Alert>
                ) : null}
                {publishPriceCents > 0 &&
                !payoutReady &&
                publishFamily === "inference" ? (
                  <Alert>
                    <AlertTitle>Payout required</AlertTitle>
                    <AlertDescription>
                      Connect a payout method before publishing a paid listing.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Field>
                  <FieldLabel>Listing type</FieldLabel>
                  <ToggleGroup
                    value={[publishFamily]}
                    onValueChange={(next) => {
                      const value = Array.isArray(next) ? next[0] : next;
                      if (
                        value === "plugin" ||
                        value === "clone" ||
                        value === "live" ||
                        value === "inference"
                      ) {
                        setPublishFamily(value);
                        setPublishCatalogEntryId("");
                        setPublishResourceId("");
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="flex-wrap"
                  >
                    <ToggleGroupItem value="plugin">Plugin</ToggleGroupItem>
                    <ToggleGroupItem value="clone">Clone pack</ToggleGroupItem>
                    <ToggleGroupItem value="live">Live share</ToggleGroupItem>
                    {saas === true ? null : (
                      <ToggleGroupItem value="inference">Inference</ToggleGroupItem>
                    )}
                  </ToggleGroup>
                  <FieldDescription>
                    {publishFamily === "plugin"
                      ? "Attach a Community catalog plugin after intake CI. GitHub Connect must match the catalog author."
                      : publishFamily === "live"
                        ? "Catalog-backed live access on this host. Select a deliveryMode live catalog row, then bind a workspace resource whose export matches the pin. Free Shared sidebar stays outside Marketplace."
                        : publishFamily === "inference"
                          ? "Metered access to a model on this Bridge. Not available on GodMode Cloud."
                          : "Attach a Community catalog pack (bundle.json in a pinned GitHub repo). Buyer installs a copy."}
                  </FieldDescription>
                </Field>

                {publishFamily === "plugin" ||
                publishFamily === "clone" ||
                publishFamily === "live" ? (
                  <Field>
                    <FieldLabel>Community catalog entry</FieldLabel>
                    {!githubLogin ? (
                      <Alert>
                        <AlertTitle>GitHub Connect required</AlertTitle>
                        <AlertDescription>
                          Connect GitHub in Personal Vault so catalog rows you own appear here.
                        </AlertDescription>
                      </Alert>
                    ) : ownedCatalogForFamily.length === 0 ? (
                      <Alert>
                        <AlertTitle>No owned catalog rows</AlertTitle>
                        <AlertDescription>
                          Submit a Community catalog PR above (or wait for merge), then refresh.
                          GitHub: {githubLogin}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Select
                        value={publishCatalogEntryId}
                        onValueChange={(v) => applyCatalogEntryToPublish(String(v))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select catalog entry you own" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {ownedCatalogForFamily.map((entry) => (
                              <SelectItem key={entry.id} value={entry.id}>
                                {entry.title} ({entry.id})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                    <FieldDescription>
                      {githubLogin
                        ? `Connected GitHub: ${githubLogin}`
                        : "Connect GitHub in Personal Vault so catalog items you own can be claimed automatically."}
                    </FieldDescription>
                  </Field>
                ) : null}

                {publishFamily === "clone" && selectedPublishCatalogEntry ? (
                  <Field>
                    <FieldLabel>Kind</FieldLabel>
                    <Select value={publishKind} onValueChange={(v) => setPublishKind(String(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {LISTING_KINDS.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}

                {publishFamily === "live" ? (
                  <>
                    <Field>
                      <FieldLabel>Kind</FieldLabel>
                      <Select value={publishKind} onValueChange={(v) => setPublishKind(String(v))}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {LISTING_KINDS.map((k) => (
                              <SelectItem key={k} value={k}>
                                {k}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="publish-resource">Source resource id</FieldLabel>
                      <Input
                        id="publish-resource"
                        value={publishResourceId}
                        onChange={(e) => setPublishResourceId(e.target.value)}
                        placeholder="Workspace entity id"
                        disabled={!publishCatalogEntryId}
                      />
                      <FieldDescription>
                        Export of this entity must match the pinned catalog bundle. Drift demotes the
                        listing until you re-bind.
                      </FieldDescription>
                    </Field>
                  </>
                ) : null}

                {publishFamily === "inference" ? (
                  <Field>
                    <FieldLabel>Inference endpoint</FieldLabel>
                    {inferenceEndpoints.length === 0 ? (
                      <FieldDescription>No inference endpoints on this workspace.</FieldDescription>
                    ) : (
                      <Select
                        value={publishResourceId}
                        onValueChange={(v) => setPublishResourceId(String(v))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose endpoint" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {inferenceEndpoints.map((ep) => (
                              <SelectItem key={ep.id} value={ep.id}>
                                {ep.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                ) : null}

                <Field>
                  <FieldLabel htmlFor="publish-title">Title</FieldLabel>
                  <Input
                    id="publish-title"
                    value={publishTitle}
                    onChange={(e) => setPublishTitle(e.target.value)}
                    placeholder="Listing title"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="publish-desc">Description</FieldLabel>
                  <Input
                    id="publish-desc"
                    value={publishDescription}
                    onChange={(e) => setPublishDescription(e.target.value)}
                    placeholder="What buyers get"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="publish-price">Price (USD)</FieldLabel>
                  <Input
                    id="publish-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={publishPriceDollars}
                    onChange={(e) => setPublishPriceDollars(e.target.value)}
                  />
                </Field>
                <Button
                  className="w-fit"
                  disabled={!canPublish || publishing}
                  onClick={() => void handlePublish()}
                >
                  {publishing
                    ? "Publishing…"
                    : publishFamily === "inference"
                      ? "Submit for review"
                      : publishFamily === "live"
                        ? "Bind Live Share"
                        : publishFamily === "plugin"
                          ? "Save plugin listing"
                          : "Save listing"}
                </Button>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">My listings</CardTitle>
              <CardDescription>
                Catalog plugins and Sell listings you own. Archive removes them from Community.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {catalogOrphans.length > 0 ? (
                <Alert>
                  <AlertTitle>Unclaimed catalog plugins</AlertTitle>
                  <AlertDescription>
                    Accept ToS, then refresh to claim:{" "}
                    {catalogOrphans.map((o) => o.title).join(", ")}
                  </AlertDescription>
                </Alert>
              ) : null}
              {myListings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No listings yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
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
                          {formatMarketplaceCents(listing.price_cents)}
                        </span>
                        <Badge variant="outline" className="ml-2">
                          {listingStatusLabel(listing.status)}
                        </Badge>
                        {listing.catalog_entry_id ? (
                          <Badge variant="secondary" className="ml-1">
                            catalog
                          </Badge>
                        ) : null}
                        {Boolean(listing.payout_ready) ? (
                          <Badge variant="outline" className="ml-1">
                            payout ready
                          </Badge>
                        ) : Number(listing.price_cents ?? 0) > 0 ? (
                          <Badge variant="outline" className="ml-1">
                            payout needed
                          </Badge>
                        ) : null}
                      </div>
                      {listing.status === "archived" ? null : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleArchive(listing.id)}
                        >
                          Archive
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <MarketplaceTosDialog
        open={tosDialogOpen}
        onOpenChange={setTosDialogOpen}
        version={tosVersion}
        accepted={tosAccepted}
        accepting={tosAccepting}
        onAccept={() => void handleAcceptTos()}
      />
    </Page>
  );
}
