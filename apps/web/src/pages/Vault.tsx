import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HardDriveIcon, RefreshCwIcon } from "lucide-react";
import {
  fetchStorageUsage,
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
import { FireworksCard } from "@/pages/ai-settings/FireworksCard";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import {
  normalizeVaultInferenceSub,
  normalizeVaultTab,
  SETTINGS_PATH,
  type VaultInferenceSub,
  type VaultTab,
} from "@/lib/navigation";

export type VaultMode = "user" | "agent" | "platform";

export type VaultProps = {
  /** Override mode (panel Agent Vault). Default: derive from ?agent= or user. */
  mode?: VaultMode;
  /** Agent id when mode is agent (panel). Query ?agent= also works. */
  agentId?: string | null;
  /** Hide page chrome when embedded in the Intelligence panel. */
  embedded?: boolean;
};

const USER_TABS: VaultTab[] = [
  "cloud",
  "integrations",
  "wallets",
  "marketplace",
  "secrets",
  "storage",
];

export default function Vault({
  mode: modeProp,
  agentId: agentIdProp,
  embedded = false,
}: VaultProps = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const agentFromQuery = searchParams.get("agent")?.trim() || null;
  const agentId = agentIdProp?.trim() || agentFromQuery;
  const mode: VaultMode =
    modeProp ?? (agentId ? "agent" : "user");

  const tabRaw = searchParams.get("tab");
  const inferredTab = normalizeVaultTab(tabRaw);

  // Dual-home: Inference lives on Platform Settings now.
  useEffect(() => {
    if (mode === "user" && inferredTab === "inference") {
      const sub = normalizeVaultInferenceSub(searchParams.get("sub"), tabRaw);
      const params = new URLSearchParams();
      params.set("vault", "inference");
      params.set("sub", sub);
      window.location.replace(`${SETTINGS_PATH}?${params.toString()}`);
    }
  }, [mode, inferredTab, searchParams, tabRaw]);

  const tab: VaultTab =
    mode === "user"
      ? USER_TABS.includes(inferredTab as VaultTab)
        ? inferredTab
        : "cloud"
      : mode === "agent"
        ? inferredTab === "secrets" || inferredTab === "inference"
          ? inferredTab
          : "secrets"
        : inferredTab === "inference" || inferredTab === "secrets"
          ? inferredTab
          : "inference";

  const inferenceSub = normalizeVaultInferenceSub(
    searchParams.get("sub"),
    tabRaw
  );

  const onTabChange = (value: string) => {
    const next = normalizeVaultTab(value);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", next);
        if (agentId) p.set("agent", agentId);
        if (next === "inference") {
          if (!p.get("sub")) p.set("sub", "subscriptions");
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
        if (agentId) p.set("agent", agentId);
        return p;
      },
      { replace: true }
    );
  };

  const title =
    mode === "agent"
      ? "Agent Vault"
      : mode === "platform"
        ? "Platform Vault"
        : "Vault";
  const description =
    mode === "agent"
      ? "Credentials private to this agent. When the agent runs, its Vault is tried first, then Platform for LLM and Exa keys."
      : mode === "platform"
        ? "Shared platform inference keys (subscriptions, API keys, Exa). Agents fall back here when they have no key of their own."
        : "Personal connect hub for GodMode Cloud, GitHub, wallets, marketplace, secrets, and storage. Inference keys live in Settings → Platform Vault.";

  const body = (
    <>
      {mode === "user" && (
        <Tabs value={tab} onValueChange={onTabChange} className="w-full">
          <TabsList variant="line" className="w-full flex-wrap justify-start">
            <TabsTrigger value="cloud">GodMode Cloud</TabsTrigger>
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
                  Seat billing and Stripe Customer Portal for this workspace.
                  Shown only on SaaS hosts.
                </p>
              </div>
              <SubscriptionCard />
            </section>
            <p className="text-sm text-muted-foreground">
              LLM subscriptions and API keys are in{" "}
              <Link
                to={`${SETTINGS_PATH}?vault=inference`}
                className="text-primary underline-offset-2 hover:underline"
              >
                Settings → Platform Vault
              </Link>
              .
            </p>
          </TabsContent>
          <TabsContent value="integrations" className="mt-4 flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-medium">GitHub</h2>
                <p className="text-sm text-muted-foreground">
                  GitHub App for Projects sync. The same App powers sign-in on this
                  host when configured.
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
                  saved here.
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
                  Free-form secrets in your User Vault. Prefer named Connect cards
                  when one exists.
                </p>
              </div>
              <AiSecretsCard vaultScope={{ ownerKind: "user" }} />
            </section>
          </TabsContent>
          <TabsContent value="storage" className="mt-4">
            <StorageTab />
          </TabsContent>
        </Tabs>
      )}

      {mode === "agent" && agentId && (
        <Tabs value={tab} onValueChange={onTabChange} className="w-full">
          <TabsList variant="line" className="w-full flex-wrap justify-start">
            <TabsTrigger value="secrets">Secrets</TabsTrigger>
            <TabsTrigger value="inference">Inference</TabsTrigger>
          </TabsList>
          <TabsContent value="secrets" className="mt-4 flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-medium">Agent secrets</h2>
                <p className="text-sm text-muted-foreground">
                  Private to this agent. Platform keys are used only when this
                  agent has no matching secret.
                </p>
              </div>
              <AiSecretsCard
                vaultScope={{ ownerKind: "agent", agentId }}
              />
            </section>
          </TabsContent>
          <TabsContent value="inference" className="mt-4">
            <InferenceTab
              sub={inferenceSub}
              onSubChange={onInferenceSubChange}
              vaultAgentId={agentId}
            />
          </TabsContent>
        </Tabs>
      )}

      {mode === "platform" && (
        <InferenceTab
          sub={inferenceSub}
          onSubChange={onInferenceSubChange}
          vaultAgentId={null}
        />
      )}
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-4">{body}</div>;
  }

  return (
    <Page>
      <PageHeader title={title} description={description} />
      {body}
    </Page>
  );
}

export function InferenceTab({
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
              {vaultAgentId
                ? " Stored in this agent Vault."
                : " Stored in the Platform Vault."}
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
              Metered BYOK. Each card stores a fixed credential and can apply a
              provider-tuned harness in Intelligence.
            </p>
          </div>
          <OpenAiPlatformCard vaultAgentId={vaultAgentId} />
          <AnthropicConsoleCard vaultAgentId={vaultAgentId} />
          <OpenRouterCard vaultAgentId={vaultAgentId} />
          <GroqCard vaultAgentId={vaultAgentId} />
          <TogetherCard vaultAgentId={vaultAgentId} />
          <FireworksCard vaultAgentId={vaultAgentId} />
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

/** Deep-link helper used by Settings Platform Vault section. */
export function platformVaultSettingsHref(sub: VaultInferenceSub = "subscriptions") {
  return `${SETTINGS_PATH}?vault=inference&sub=${sub}`;
}
