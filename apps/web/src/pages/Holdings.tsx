import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BanknoteIcon,
  BitcoinIcon,
  BuildingIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LandmarkIcon,
  LinkIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  WalletIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useHoldings } from "@/hooks/use-holdings";
import {
  connectCryptoWallet,
  connectPayPal,
  createManualConnection,
  deleteConnection,
  previewCryptoBalance,
  refreshConnection,
  requestMetaMaskAddress,
  saveMoralisConfig,
  savePayPalConfig,
  type CryptoPortfolio,
  type HoldingCategory,
  type HoldingConnection,
  type TokenBreakdown,
} from "@/lib/api-holdings";
import { toast } from "sonner";

/* -------------------------------------------------------------------------- */
/* Provider catalog                                                            */
/* -------------------------------------------------------------------------- */

interface Provider {
  key: string;
  name: string;
  hint: string;
  currency: string;
  live?: boolean;
  disabled?: boolean;
}

interface CategoryDef {
  category: HoldingCategory;
  title: string;
  description: string;
  icon: typeof WalletIcon;
  referenceLabel?: string;
  referencePlaceholder?: string;
  providers: Provider[];
}

const CATEGORIES: CategoryDef[] = [
  {
    category: "bank",
    title: "Canadian bank accounts",
    description:
      "Track bank balances manually — live bank linking is not available yet.",
    icon: LandmarkIcon,
    referenceLabel: "Account (last 4)",
    referencePlaceholder: "1234",
    providers: [
      { key: "flinks", name: "Flinks", hint: "Manual balance entry", currency: "CAD" },
      { key: "plaid-ca", name: "Plaid (Canada)", hint: "Manual balance entry", currency: "CAD" },
      { key: "mx", name: "MX", hint: "Manual balance entry", currency: "CAD" },
      { key: "interac", name: "Other CA bank", hint: "Manual balance entry", currency: "CAD" },
    ],
  },
  {
    category: "wallet",
    title: "Crypto wallets",
    description: "Self-custody wallets — connect or track read-only by address.",
    icon: BitcoinIcon,
    referenceLabel: "Wallet address",
    referencePlaceholder: "0x…",
    providers: [
      { key: "metamask", name: "MetaMask", hint: "Live EVM wallet sync", currency: "USD", live: true },
      { key: "walletconnect", name: "WalletConnect", hint: "Not available yet", currency: "USD", disabled: true },
      { key: "ledger", name: "Ledger", hint: "Not available yet", currency: "USD", disabled: true },
      { key: "address", name: "Track by address", hint: "Live read-only, any chain", currency: "USD", live: true },
    ],
  },
  {
    category: "exchange",
    title: "Crypto exchanges",
    description: "Enter exchange balances manually — API sync is not available yet.",
    icon: BuildingIcon,
    referenceLabel: "API key label",
    referencePlaceholder: "read-only key name",
    providers: [
      { key: "newton", name: "Newton", hint: "Canadian exchange", currency: "CAD" },
      { key: "bitbuy", name: "Bitbuy", hint: "Canadian exchange", currency: "CAD" },
      { key: "coinbase", name: "Coinbase", hint: "Global exchange", currency: "USD" },
      { key: "kraken", name: "Kraken", hint: "Global exchange", currency: "USD" },
      { key: "binance", name: "Binance", hint: "Global exchange", currency: "USD" },
    ],
  },
  {
    category: "paypal",
    title: "PayPal",
    description: "Business PayPal balance via Reporting API.",
    icon: BanknoteIcon,
    providers: [
      { key: "paypal", name: "PayPal Business", hint: "Live balance sync", currency: "CAD", live: true },
    ],
  },
  {
    category: "manual",
    title: "Manual & other",
    description: "Cash, brokerages, or anything else — tracked manually.",
    icon: WalletIcon,
    referenceLabel: "Note",
    referencePlaceholder: "optional note",
    providers: [
      { key: "cash", name: "Cash", hint: "Physical or stored cash", currency: "CAD" },
      { key: "brokerage", name: "Brokerage", hint: "Questrade, Wealthsimple…", currency: "CAD" },
      { key: "other", name: "Other", hint: "Anything that holds value", currency: "CAD" },
    ],
  },
];

const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.category, c]));

function providerName(category: HoldingCategory, providerKey: string): string {
  const def = CATEGORY_BY_KEY.get(category);
  return def?.providers.find((p) => p.key === providerKey)?.name ?? providerKey;
}

function formatMoney(amount: number, currency = "CAD"): string {
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function isLiveProvider(category: HoldingCategory, key: string): boolean {
  if (category === "wallet" && (key === "metamask" || key === "address")) return true;
  if (category === "paypal" && key === "paypal") return true;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function Holdings() {
  return <HoldingsConnectionsContent />;
}

export function HoldingsConnectionsContent({
  categoryFilter,
  showNetWorth = true,
  setupOpen: controlledSetupOpen,
  onSetupOpenChange,
}: {
  categoryFilter?: HoldingCategory[];
  showNetWorth?: boolean;
  setupOpen?: boolean;
  onSetupOpenChange?: (open: boolean) => void;
}) {
  const { data, config, loading, refresh } = useHoldings();
  const [draft, setDraft] = useState<{
    category: HoldingCategory;
    provider: Provider;
  } | null>(null);
  const [internalSetupOpen, setInternalSetupOpen] = useState(false);
  const setupOpen = controlledSetupOpen ?? internalSetupOpen;
  const setSetupOpen = onSetupOpenChange ?? setInternalSetupOpen;
  const [busyId, setBusyId] = useState<string | null>(null);

  const connections = data?.connections ?? [];
  const netWorthCad = data?.netWorthCad ?? 0;

  const byCategory = useMemo(() => {
    const map = new Map<HoldingCategory, HoldingConnection[]>();
    for (const c of connections) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return map;
  }, [connections]);

  const handleRemove = async (id: string) => {
    try {
      await deleteConnection(id);
      await refresh();
      toast.success("Account removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    }
  };

  const handleRefresh = async (id: string) => {
    setBusyId(id);
    try {
      await refreshConnection(id);
      await refresh();
      toast.success("Balance updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {showNetWorth && (
        <NetWorthSummary netWorthCad={netWorthCad} count={connections.length} loading={loading} />
      )}

      <div className="flex flex-col gap-4">
        {(categoryFilter
          ? CATEGORIES.filter((c) => categoryFilter.includes(c.category))
          : CATEGORIES
        ).map((cat) => (
          <ConnectionCategory
            key={cat.category}
            def={cat}
            accounts={byCategory.get(cat.category) ?? []}
            config={config}
            busyId={busyId}
            onConnect={(provider) => setDraft({ category: cat.category, provider })}
            onRemove={handleRemove}
            onRefresh={handleRefresh}
          />
        ))}
      </div>

      <ConnectDialog
        open={draft !== null}
        draft={draft}
        config={config}
        onClose={() => setDraft(null)}
        onDone={async () => {
          setDraft(null);
          await refresh();
        }}
      />

      <SetupDialog open={setupOpen} config={config} onClose={() => setSetupOpen(false)} onSaved={refresh} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Net worth                                                                   */
/* -------------------------------------------------------------------------- */

function NetWorthSummary({
  netWorthCad,
  count,
  loading,
}: {
  netWorthCad: number;
  count: number;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Estimated net worth (CAD)</CardDescription>
        <CardTitle className="flex items-center gap-2 text-3xl tabular-nums">
          {loading && !count ? <Spinner className="size-5" /> : null}
          {formatMoney(netWorthCad, "CAD")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <span className="text-xs text-muted-foreground">
          {count === 0
            ? "No accounts connected yet"
            : `${count} account${count === 1 ? "" : "s"} connected · balances in CAD`}
        </span>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Category card                                                               */
/* -------------------------------------------------------------------------- */

function ConnectionCategory({
  def,
  accounts,
  config,
  busyId,
  onConnect,
  onRemove,
  onRefresh,
}: {
  def: CategoryDef;
  accounts: HoldingConnection[];
  config: ReturnType<typeof useHoldings>["config"];
  busyId: string | null;
  onConnect: (provider: Provider) => void;
  onRemove: (id: string) => void;
  onRefresh: (id: string) => void;
}) {
  const Icon = def.icon;
  const subtotalCad = accounts.reduce((s, a) => s + a.balanceCad, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Icon className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle>{def.title}</CardTitle>
            <CardDescription>{def.description}</CardDescription>
          </div>
          {subtotalCad > 0 && (
            <span className="font-mono text-sm tabular-nums">
              {formatMoney(subtotalCad, "CAD")}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {def.providers.map((provider) => {
            const needsMoralis =
              def.category === "wallet" &&
              provider.live &&
              !config?.moralis.configured;
            const needsPayPal =
              def.category === "paypal" &&
              provider.live &&
              !config?.paypal.configured;
            return (
              <Button
                key={provider.key}
                variant="outline"
                size="sm"
                disabled={provider.disabled || needsMoralis || needsPayPal}
                onClick={() => onConnect(provider)}
                title={
                  provider.disabled
                    ? provider.hint
                    : needsMoralis
                      ? "Configure Moralis in Integration setup first"
                      : needsPayPal
                        ? "Configure PayPal in Integration setup first"
                        : provider.hint
                }
              >
                <LinkIcon data-icon="inline-start" />
                {provider.name}
                {provider.live ? (
                  <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                    Live sync
                  </Badge>
                ) : !provider.disabled ? (
                  <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">
                    Manual
                  </Badge>
                ) : null}
              </Button>
            );
          })}
        </div>

        {accounts.length > 0 && (
          <ul className="flex flex-col divide-y rounded-lg border">
            {accounts.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                busy={busyId === a.id}
                onRemove={() => onRemove(a.id)}
                onRefresh={() => onRefresh(a.id)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AccountRow({
  account,
  busy,
  onRemove,
  onRefresh,
}: {
  account: HoldingConnection;
  busy: boolean;
  onRemove: () => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tokens =
    account.breakdown &&
    typeof account.breakdown === "object" &&
    account.breakdown !== null &&
    "tokens" in account.breakdown
      ? (account.breakdown as { tokens?: TokenBreakdown[] }).tokens ?? []
      : [];
  const canRefresh =
    account.category === "wallet" || account.category === "paypal";

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{account.label}</span>
            <Badge variant="outline" className="shrink-0">
              {providerName(account.category, account.provider)}
            </Badge>
            {account.status === "error" && (
              <Badge variant="destructive">sync error</Badge>
            )}
          </div>
          {account.reference && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {account.reference}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            synced {formatRelative(account.lastSyncedAt)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-sm tabular-nums">
            {formatMoney(account.balanceCad, "CAD")}
          </span>
          {account.currency !== "CAD" && (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {formatMoney(account.balance, account.currency)}
            </span>
          )}
        </div>
        {canRefresh && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh balance"
            disabled={busy}
            onClick={onRefresh}
          >
            {busy ? <Spinner className="size-3.5" /> : <RefreshCwIcon />}
          </Button>
        )}
        {tokens.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={expanded ? "Collapse tokens" : "Expand tokens"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${account.label}`}
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon />
        </Button>
      </div>
      {expanded && tokens.length > 0 && (
        <ul className="border-t bg-muted/30 px-3 py-2">
          {tokens.slice(0, 20).map((t, i) => (
            <li
              key={`${t.chain}-${t.symbol}-${i}`}
              className="flex items-center justify-between py-0.5 text-xs"
            >
              <span className="truncate">
                {t.symbol}{" "}
                <span className="text-muted-foreground">({t.chain})</span>
              </span>
              <span className="font-mono tabular-nums">
                {formatMoney(t.cadValue, "CAD")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Setup dialog                                                                */
/* -------------------------------------------------------------------------- */

function SetupDialog({
  open,
  config,
  onClose,
  onSaved,
}: {
  open: boolean;
  config: ReturnType<typeof useHoldings>["config"];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [moralisKey, setMoralisKey] = useState("");
  const [paypalId, setPaypalId] = useState("");
  const [paypalSecret, setPaypalSecret] = useState("");
  const [paypalEnv, setPaypalEnv] = useState<"sandbox" | "live">("sandbox");
  const [busy, setBusy] = useState<string | null>(null);

  const saveMoralis = async () => {
    if (!moralisKey.trim()) return;
    setBusy("moralis");
    try {
      await saveMoralisConfig(moralisKey.trim());
      toast.success("Moralis API key saved and verified");
      setMoralisKey("");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Moralis setup failed");
    } finally {
      setBusy(null);
    }
  };

  const savePayPal = async () => {
    if (!paypalId.trim() || !paypalSecret.trim()) return;
    setBusy("paypal");
    try {
      await savePayPalConfig({
        clientId: paypalId.trim(),
        clientSecret: paypalSecret.trim(),
        env: paypalEnv,
      });
      toast.success("PayPal credentials saved and verified");
      setPaypalId("");
      setPaypalSecret("");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PayPal setup failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Integration setup</DialogTitle>
          <DialogDescription>
            API credentials are encrypted and stored locally on this machine. Required
            for live crypto portfolios (Moralis) and PayPal business balances.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <Label>Moralis API key</Label>
              {config?.moralis.configured && (
                <Badge variant="secondary">configured {config.moralis.masked}</Badge>
              )}
            </div>
            <Input
              type="password"
              value={moralisKey}
              onChange={(e) => setMoralisKey(e.target.value)}
              placeholder="Paste Moralis Web3 API key"
            />
            <Button size="sm" disabled={busy === "moralis" || !moralisKey.trim()} onClick={saveMoralis}>
              {busy === "moralis" ? <Spinner className="size-3.5" /> : null}
              Save & test Moralis
            </Button>
          </section>

          <section className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <Label>PayPal business app</Label>
              {config?.paypal.configured && (
                <Badge variant="secondary">
                  {config.paypal.env} · {config.paypal.clientIdMasked}
                </Badge>
              )}
            </div>
            <Input
              value={paypalId}
              onChange={(e) => setPaypalId(e.target.value)}
              placeholder="Client ID"
            />
            <Input
              type="password"
              value={paypalSecret}
              onChange={(e) => setPaypalSecret(e.target.value)}
              placeholder="Client secret"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={paypalEnv === "sandbox" ? "default" : "outline"}
                onClick={() => setPaypalEnv("sandbox")}
              >
                Sandbox
              </Button>
              <Button
                type="button"
                size="sm"
                variant={paypalEnv === "live" ? "default" : "outline"}
                onClick={() => setPaypalEnv("live")}
              >
                Live
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              App must have Transaction Search / Reporting enabled for balance access.
            </p>
            <Button
              size="sm"
              disabled={busy === "paypal" || !paypalId.trim() || !paypalSecret.trim()}
              onClick={savePayPal}
            >
              {busy === "paypal" ? <Spinner className="size-3.5" /> : null}
              Save & test PayPal
            </Button>
          </section>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Connect dialog                                                              */
/* -------------------------------------------------------------------------- */

function ConnectDialog({
  open,
  draft,
  config,
  onClose,
  onDone,
}: {
  open: boolean;
  draft: { category: HoldingCategory; provider: Provider } | null;
  config: ReturnType<typeof useHoldings>["config"];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const def = draft ? CATEGORY_BY_KEY.get(draft.category) : undefined;
  const [label, setLabel] = useState("");
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CryptoPortfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft) {
      setLabel(draft.provider.name);
      setBalance("");
      setCurrency(draft.provider.currency);
      setReference("");
      setPreview(null);
      setError(null);
    }
  }, [draft]);

  if (!draft || !def) return null;

  const live = isLiveProvider(draft.category, draft.provider.key);
  const needsMoralis =
    draft.category === "wallet" && live && !config?.moralis.configured;
  const needsPayPal =
    draft.category === "paypal" && live && !config?.paypal.configured;

  const runMetaMask = async () => {
    setBusy(true);
    setError(null);
    try {
      const address = await requestMetaMaskAddress();
      setReference(address);
      const portfolio = await previewCryptoBalance(address);
      setPreview(portfolio);
      setLabel(`MetaMask ${address.slice(0, 6)}…${address.slice(-4)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const previewAddress = async () => {
    if (!reference.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const portfolio = await previewCryptoBalance(reference.trim());
      setPreview(portfolio);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmCrypto = async () => {
    const address = reference.trim() || preview?.address;
    if (!address) return;
    setBusy(true);
    try {
      await connectCryptoWallet({
        address,
        provider: draft.provider.key,
        label: label.trim() || draft.provider.name,
      });
      toast.success("Wallet connected");
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmPayPal = async () => {
    setBusy(true);
    try {
      await connectPayPal(label.trim() || "PayPal Business");
      toast.success("PayPal connected");
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PayPal connect failed");
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async () => {
    const parsedBalance = Number(balance);
    if (!label.trim() || !Number.isFinite(parsedBalance)) return;
    setBusy(true);
    try {
      await createManualConnection({
        category: draft.category,
        provider: draft.provider.key,
        label: label.trim(),
        balance: parsedBalance,
        currency: currency.trim().toUpperCase() || "CAD",
        reference: reference.trim() || undefined,
      });
      toast.success("Account added");
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const isCryptoLive =
    draft.category === "wallet" &&
    (draft.provider.key === "metamask" || draft.provider.key === "address");
  const isPayPalLive = draft.category === "paypal" && draft.provider.key === "paypal";

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {draft.provider.name}</DialogTitle>
          <DialogDescription>{draft.provider.hint}</DialogDescription>
        </DialogHeader>

        {needsMoralis && (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400">
            Configure your Moralis API key in Integration setup before connecting
            crypto wallets.
          </p>
        )}
        {needsPayPal && (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-600 dark:text-amber-400">
            Configure PayPal client ID and secret in Integration setup first.
          </p>
        )}

        {isCryptoLive && !needsMoralis && (
          <div className="flex flex-col gap-3">
            {draft.provider.key === "metamask" && (
              <Button onClick={runMetaMask} disabled={busy}>
                {busy ? <Spinner className="size-3.5" /> : <LinkIcon data-icon="inline-start" />}
                Connect MetaMask
              </Button>
            )}
            {draft.provider.key === "address" && (
              <>
                <Field label="Wallet address">
                  <Input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="0x…"
                    className="font-mono text-xs"
                  />
                </Field>
                <Button variant="outline" onClick={previewAddress} disabled={busy || !reference.trim()}>
                  Preview portfolio
                </Button>
              </>
            )}
            {preview && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium tabular-nums">
                  {formatMoney(preview.totalCad, "CAD")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {preview.tokens.length} tokens · {preview.address.slice(0, 10)}…
                </p>
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {isPayPalLive && !needsPayPal && (
          <div className="flex flex-col gap-3">
            <Field label="Account label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">
              Fetches your business PayPal balance using stored API credentials.
            </p>
          </div>
        )}

        {!live && (
          <div className="flex flex-col gap-3">
            <Field label="Account name">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
            </Field>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Balance">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Currency">
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-20 uppercase"
                  maxLength={3}
                />
              </Field>
            </div>
            {def.referenceLabel && (
              <Field label={def.referenceLabel}>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={def.referencePlaceholder}
                />
              </Field>
            )}
            <p className="text-xs text-muted-foreground">
              Live sync for this provider is not yet available — balance is stored
              manually on the server.
            </p>
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} onClick={onClose}>
            Cancel
          </DialogClose>
          {isCryptoLive && !needsMoralis && (
            <Button
              onClick={confirmCrypto}
              disabled={busy || !preview}
            >
              Add wallet
            </Button>
          )}
          {isPayPalLive && !needsPayPal && (
            <Button onClick={confirmPayPal} disabled={busy}>
              Connect PayPal
            </Button>
          )}
          {!live && (
            <Button
              onClick={saveManual}
              disabled={busy || !label.trim() || !Number.isFinite(Number(balance))}
            >
              <PlusIcon data-icon="inline-start" />
              Add account
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5")}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
