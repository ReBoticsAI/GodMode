import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptMarketplaceTos,
  addCatalogSource,
  confirmMarketplaceCryptoPayment,
  connectMarketplacePayout,
  fetchInstalledCatalog,
  fetchMarketplaceCommerceConfig,
  fetchOfficialCatalog,
  fetchUnofficialCatalog,
  installCatalogEntry,
  installWorkspacePlugin,
  registerLocalPlugin,
  removeCatalogSource,
  removeLocalPlugin,
  startMarketplaceCheckout,
  uninstallWorkspacePlugin,
  type CatalogEntry,
  type DiscoveredPlugin,
  type TenantPluginRow,
} from "@/api";
import { Button } from "@/components/ui/button";
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
import { FolderOpenIcon, Trash2Icon } from "lucide-react";

const OFFICIAL_REPO =
  "https://github.com/ReBoticsAI/GodMode-Marketplace/blob/main/CONTRIBUTING.md";

function reloadAfterPluginChange(built?: boolean) {
  if (built) {
    toast.info("Plugin was built — reloading to activate UI…");
  } else {
    toast.info("Reloading to activate plugin UI…");
  }
  window.setTimeout(() => window.location.reload(), 400);
}

function formatPrice(entry: CatalogEntry): string {
  const cents = Number(entry.priceCents ?? 0);
  if (cents <= 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
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
              {entry.author} · v{entry.version} · {entry.kind}
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
  const [tab, setTab] = useState("official");
  const [official, setOfficial] = useState<CatalogEntry[]>([]);
  const [unofficial, setUnofficial] = useState<CatalogEntry[]>([]);
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
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [cryptoPrompt, setCryptoPrompt] = useState<{
    orderId: string;
    treasuryAddress: string;
    amountCents: number;
    asset: string;
    chainId: number;
  } | null>(null);
  const [cryptoTxHash, setCryptoTxHash] = useState("");
  const [metamaskAddress, setMetamaskAddress] = useState("");
  const [paypalMerchantId, setPaypalMerchantId] = useState("");
  const [stripeConnectId, setStripeConnectId] = useState("");
  const [tosVersion, setTosVersion] = useState("1");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [off, unoff, inst] = await Promise.all([
        fetchOfficialCatalog(),
        fetchUnofficialCatalog(),
        fetchInstalledCatalog(),
      ]);
      setOfficial(off.entries);
      setUnofficial(unoff.entries);
      setSources(unoff.sources);
      setDiscovered(unoff.discovered);
      setLocalPaths(unoff.localPaths);
      setCatalogInstalls(inst.catalogInstalls);
      setTenantPlugins(inst.plugins);
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
      .then((cfg) => setTosVersion(cfg.tosVersion))
      .catch(() => undefined);
  }, [reload]);

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
  const unofficialFiltered = useMemo(() => filterEntries(unofficial), [unofficial, q]);
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
      } else {
        reloadAfterPluginChange(Boolean(result.built));
        return;
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
      const origin = window.location.origin;
      const result = await startMarketplaceCheckout({
        provider,
        catalogEntryId: entry.id,
        listingId: entry.listingId,
        successUrl: `${origin}/marketplace?paid=1&entry=${encodeURIComponent(entry.id)}`,
        cancelUrl: `${origin}/marketplace?canceled=1`,
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

  const handleConfirmCrypto = async () => {
    if (!cryptoPrompt || !cryptoTxHash.trim()) return;
    try {
      await confirmMarketplaceCryptoPayment(cryptoPrompt.orderId, cryptoTxHash.trim());
      toast.success("Payment recorded — you can install now");
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
      toast.success(`Accepted Marketplace ToS v${result.tosVersion}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ToS acceptance failed");
    }
  };

  const handleConnectPayout = async () => {
    try {
      await acceptMarketplaceTos();
      await connectMarketplacePayout({
        stripeConnectAccountId: stripeConnectId.trim() || null,
        paypalMerchantId: paypalMerchantId.trim() || null,
        metamaskAddress: metamaskAddress.trim() || null,
        payoutPreference: metamaskAddress.trim()
          ? "crypto"
          : paypalMerchantId.trim()
            ? "paypal"
            : stripeConnectId.trim()
              ? "stripe"
              : undefined,
      });
      toast.success("Seller payout methods saved (10% platform fee on sales)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save payout methods");
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

  return (
    <Page>
      <PageHeader
        title="Marketplace"
        description="Install Official and community packs. Paid Official items go 100% to ReBotics; user listings take a 10% platform fee. Chargebacks ban Marketplace access."
        actions={
          <Button variant="outline" size="sm" render={<a href={OFFICIAL_REPO} target="_blank" rel="noreferrer" />}>
            Submit to Official
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="official">Official</TabsTrigger>
          <TabsTrigger value="unofficial">Unofficial</TabsTrigger>
          <TabsTrigger value="installed">Installed</TabsTrigger>
          <TabsTrigger value="seller">Sell</TabsTrigger>
        </TabsList>

        <TabsContent value="official" className="mt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading official catalog…</p>
          ) : officialFiltered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No official listings found. Check your network or set MARKETPLACE_LOCAL_CATALOG_PATH
              for local dev.
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

        <TabsContent value="unofficial" className="mt-4 space-y-6">
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

          {unofficialFiltered.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">From unofficial catalogs</p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {unofficialFiltered.map((entry) => (
                  <EntryCard
                    key={`unofficial-${entry.id}-${entry.sourceCatalog}`}
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

        <TabsContent value="installed" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workspace plugins</CardTitle>
              <CardDescription>
                Domain packs enabled for this workspace. Uninstall removes sidebar structure and
                tenant hooks; local folders stay registered until you remove the path.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenantPlugins.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No plugins installed on this workspace. Use Official or Unofficial to add one.
                </p>
              ) : (
                <ul className="space-y-2">
                  {tenantPlugins.map((row) => {
                    const meta = discovered.find((p) => p.id === row.plugin_id);
                    return (
                      <DiscoveredPluginRow
                        key={row.plugin_id}
                        plugin={
                          meta ?? {
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
                          meta?.source === "marketplace" && meta.pluginRoot
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
                Digital goods are final once delivered. A chargeback or payment dispute results in a
                permanent Marketplace ban (no buying or earning). Current ToS version: {tosVersion}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void handleAcceptTos()}>Accept Marketplace ToS</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Seller payouts</CardTitle>
              <CardDescription>
                Connect at least one payout rail before publishing paid listings. Platform fee is
                10%. Official ReBotics catalog sales are separate (100% to platform).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Stripe Connect account id</Label>
                <Input
                  value={stripeConnectId}
                  onChange={(e) => setStripeConnectId(e.target.value)}
                  placeholder="acct_…"
                />
              </div>
              <div className="space-y-1">
                <Label>PayPal merchant id</Label>
                <Input
                  value={paypalMerchantId}
                  onChange={(e) => setPaypalMerchantId(e.target.value)}
                  placeholder="PayPal merchant id"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>MetaMask address</Label>
                <Input
                  value={metamaskAddress}
                  onChange={(e) => setMetamaskAddress(e.target.value)}
                  placeholder="0x…"
                />
              </div>
              <Button className="w-fit" onClick={() => void handleConnectPayout()}>
                Save payout methods
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
