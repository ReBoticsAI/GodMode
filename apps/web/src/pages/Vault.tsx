import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HardDriveIcon, RefreshCwIcon } from "lucide-react";
import {
  fetchAiAgents,
  fetchStorageUsage,
  type AiAgent,
  type StorageUsageReport,
} from "@/api";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiSecretsCard } from "@/pages/ai-settings/AiSecretsCard";
import { AnthropicConsoleCard } from "@/pages/ai-settings/AnthropicConsoleCard";
import { CursorSubscriptionCard } from "@/pages/ai-settings/CursorSubscriptionCard";
import { ExaConnectCard } from "@/pages/ai-settings/ExaConnectCard";
import { GithubConnectCard } from "@/pages/ai-settings/GithubConnectCard";
import { HoldingsConnectCard } from "@/pages/ai-settings/HoldingsConnectCard";
import { SellerPayoutsCard } from "@/pages/ai-settings/SellerPayoutsCard";
import { OpenAiPlatformCard } from "@/pages/ai-settings/OpenAiPlatformCard";
import { OpenRouterCard } from "@/pages/ai-settings/OpenRouterCard";
import { GroqCard } from "@/pages/ai-settings/GroqCard";
import { TogetherCard } from "@/pages/ai-settings/TogetherCard";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import {
  normalizeVaultInferenceSub,
  normalizeVaultTab,
  type VaultInferenceSub,
} from "@/lib/navigation";

/** Select value for Personal Vault (maps to `ai_secrets.agent_id IS NULL`). */
export const VAULT_OWNER_PERSONAL = "__personal__";

export default function Vault() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRaw = searchParams.get("tab");
  const tab = normalizeVaultTab(tabRaw);
  const inferenceSub = normalizeVaultInferenceSub(searchParams.get("sub"), tabRaw);

  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [ownerSelect, setOwnerSelect] = useState(VAULT_OWNER_PERSONAL);

  useEffect(() => {
    fetchAiAgents()
      .then((r) => setAgents(r.agents.filter((a) => a.enabled && !a.isTemplate)))
      .catch(() => setAgents([]));
  }, []);

  const vaultAgentId =
    ownerSelect === VAULT_OWNER_PERSONAL ? null : ownerSelect;

  const onTabChange = (value: string) => {
    const next = normalizeVaultTab(value);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", next);
        if (next === "inference") {
          if (!p.get("sub") || normalizeVaultTab(prev.get("tab")) !== "inference") {
            p.set("sub", "subscriptions");
          }
        } else {
          p.delete("sub");
        }
        return p;
      },
      { replace: true }
    );
  };

  const onInferenceSubChange = (value: string) => {
    const next = normalizeVaultInferenceSub(value);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", "inference");
        p.set("sub", next);
        return p;
      },
      { replace: true }
    );
  };

  return (
    <Page>
      <PageHeader
        title="Vault"
        description="Connect hub for GodMode Cloud, inference, integrations, wallets, marketplace, secrets, and storage. Provider subscriptions and API keys are separate from GodMode Cloud seat billing."
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex max-w-md flex-1 flex-col gap-1.5">
          <Label htmlFor="vault-owner">Vault owner</Label>
          <Select value={ownerSelect} onValueChange={setOwnerSelect}>
            <SelectTrigger id="vault-owner" className="w-full">
              <SelectValue placeholder="Personal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={VAULT_OWNER_PERSONAL}>Personal</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {vaultAgentId
              ? "Inference Connect cards and All Secrets edit this agent's Vault. When the agent runs, its Vault is tried first, then Personal."
              : "Personal Vault is the shared fallback for agents that do not have their own key. GitHub, Cloud seats, Marketplace, and Wallets stay on Personal."}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={onTabChange} className="w-full">
        <TabsList variant="line" className="w-full flex-wrap justify-start">
          <TabsTrigger value="cloud">GodMode Cloud</TabsTrigger>
          <TabsTrigger value="inference">Inference</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="wallets">Wallets</TabsTrigger>
          <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
          <TabsTrigger value="secrets">All Secrets</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
        </TabsList>

        <TabsContent value="cloud" className="mt-4 flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-medium">GodMode Cloud</h2>
              <p className="text-sm text-muted-foreground">
                Seat billing and Stripe Customer Portal for this workspace. Shown
                only on SaaS hosts. Always Personal (not per-agent).
              </p>
            </div>
            <SubscriptionCard />
          </section>
        </TabsContent>
        <TabsContent value="inference" className="mt-4">
          <InferenceTab
            sub={inferenceSub}
            onSubChange={onInferenceSubChange}
            vaultAgentId={vaultAgentId}
          />
        </TabsContent>
        <TabsContent value="integrations" className="mt-4 flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-medium">GitHub</h2>
              <p className="text-sm text-muted-foreground">
                GitHub App for Projects sync. The same App powers sign-in on this
                host when configured. Always Personal (not per-agent).
              </p>
            </div>
            <GithubConnectCard />
          </section>
        </TabsContent>
        <TabsContent value="wallets" className="mt-4 flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-medium">Wallets</h2>
              <p className="text-sm text-muted-foreground">
                Moralis and PayPal API credentials for live Bank / wallet sync.
                Connect wallets and PayPal balances on Bank after credentials are
                saved here. Always Personal (not per-agent).
              </p>
            </div>
            <HoldingsConnectCard />
          </section>
        </TabsContent>
        <TabsContent value="marketplace" className="mt-4 flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-medium">Seller payouts</h2>
              <p className="text-sm text-muted-foreground">
                Seller Stripe Connect for Community payouts. Marketplace → Sell
                links here to connect; ToS Accept and listing tools stay on Sell.
                Always Personal (not per-agent).
              </p>
            </div>
            <SellerPayoutsCard
              returnUrl={`${window.location.origin}/vault?tab=marketplace&stripe_connect=return`}
              refreshUrl={`${window.location.origin}/vault?tab=marketplace&stripe_connect=refresh`}
            />
          </section>
        </TabsContent>
        <TabsContent value="secrets" className="mt-4 flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-medium">All secrets</h2>
              <p className="text-sm text-muted-foreground">
                Free-form secrets for the selected Vault owner. Prefer named
                Connect cards when one exists.
              </p>
            </div>
            <AiSecretsCard vaultAgentId={vaultAgentId} />
          </section>
        </TabsContent>
        <TabsContent value="storage" className="mt-4">
          <StorageTab />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function InferenceTab({
  sub,
  onSubChange,
  vaultAgentId,
}: {
  sub: VaultInferenceSub;
  onSubChange: (value: string) => void;
  vaultAgentId: string | null;
}) {
  return (
    <Tabs value={sub} onValueChange={onSubChange} className="w-full">
      <TabsList variant="line" className="w-full flex-wrap justify-start">
        <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
        <TabsTrigger value="api-keys">API Keys</TabsTrigger>
        <TabsTrigger value="search">Search</TabsTrigger>
      </TabsList>

      <TabsContent value="subscriptions" className="mt-4 flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium">Subscriptions</h2>
            <p className="text-sm text-muted-foreground">
              Use your plan (billed by the provider). Cursor is available today.
            </p>
          </div>
          <CursorSubscriptionCard vaultAgentId={vaultAgentId} />
        </section>
      </TabsContent>

      <TabsContent value="api-keys" className="mt-4 flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium">API keys</h2>
            <p className="text-sm text-muted-foreground">
              Metered BYOK for the selected Vault owner. Each card stores a fixed
              credential and can apply a provider-tuned harness in Intelligence.
            </p>
          </div>
          <OpenAiPlatformCard vaultAgentId={vaultAgentId} />
          <AnthropicConsoleCard vaultAgentId={vaultAgentId} />
          <OpenRouterCard vaultAgentId={vaultAgentId} />
          <GroqCard vaultAgentId={vaultAgentId} />
          <TogetherCard vaultAgentId={vaultAgentId} />
        </section>
      </TabsContent>

      <TabsContent value="search" className="mt-4 flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-medium">Web search</h2>
            <p className="text-sm text-muted-foreground">
              Keys for agent web_search and fetch_url. Exa is available today.
            </p>
          </div>
          <ExaConnectCard vaultAgentId={vaultAgentId} />
        </section>
      </TabsContent>
    </Tabs>
  );
}

function StorageTab() {
  const [storage, setStorage] = useState<StorageUsageReport | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);

  const loadStorage = useCallback(() => {
    setStorageBusy(true);
    fetchStorageUsage()
      .then(setStorage)
      .catch((err) => console.error("storage usage failed", err))
      .finally(() => setStorageBusy(false));
  }, []);

  useEffect(() => {
    loadStorage();
  }, [loadStorage]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveIcon className="size-4" />
          Storage
        </CardTitle>
        <CardDescription>
          Database and data-store sizes. Monitor growth before trimming or upgrading stores.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={loadStorage} disabled={storageBusy}>
            <RefreshCwIcon
              data-icon="inline-start"
              className={storageBusy ? "animate-spin" : ""}
            />
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {storage ? (
          <>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                <span className="text-muted-foreground">Platform data total: </span>
                <span className="font-medium">{storage.totalBytesLabel}</span>
              </span>
              {storage.diskFreeBytesLabel && (
                <span>
                  <span className="text-muted-foreground">Disk free: </span>
                  <span className="font-medium">{storage.diskFreeBytesLabel}</span>
                </span>
              )}
            </div>
            <div className="overflow-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Store</th>
                    <th className="px-2 py-1.5 font-medium text-right">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {storage.entries.map((e) => (
                    <tr key={e.id} className="border-b border-border/50 last:border-0">
                      <td className="px-2 py-1.5">
                        <div>{e.label}</div>
                        {e.detail && (
                          <div className="text-[10px] text-muted-foreground">{e.detail}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{e.bytesLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {storage.largestTables.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                  Largest SQLite tables
                </h4>
                <div className="flex flex-wrap gap-2">
                  {storage.largestTables.slice(0, 8).map((t) => (
                    <Badge key={t.name} variant="outline" className="font-mono text-[10px]">
                      {t.name}: {t.rows.toLocaleString()} rows
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {storageBusy ? "Loading storage usage…" : "Storage usage unavailable."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
