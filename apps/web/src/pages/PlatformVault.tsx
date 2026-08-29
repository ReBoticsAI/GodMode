import { Link, useSearchParams } from "react-router-dom";
import { KeyRoundIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import { AccountDeletionCard } from "@/components/settings/AccountDeletionCard";
import {
  normalizePlatformVaultSection,
  normalizeVaultInferenceSub,
  VAULT_PATH,
  type PlatformVaultSection,
  type VaultInferenceSub,
} from "@/lib/navigation";
import { InferenceTab } from "@/pages/Vault";
import { AiSecretsCard } from "@/pages/ai-settings/AiSecretsCard";

export default function PlatformVault() {
  const [searchParams, setSearchParams] = useSearchParams();
  const platformSection = normalizePlatformVaultSection(
    searchParams.get("vault")
  );
  const inferenceSub = normalizeVaultInferenceSub(searchParams.get("sub"));

  const onSectionChange = (value: string) => {
    const next = value as PlatformVaultSection;
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("vault", next);
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
        p.set("vault", "inference");
        p.set("sub", next);
        return p;
      },
      { replace: true }
    );
  };

  return (
    <Page>
      <PageHeader
        title="Platform Vault"
        description="Your account Connect credentials: GodMode Cloud seats, LLM subscriptions, API keys, and Exa. Shared across your workspaces. Agents fall back here when they have no key of their own. Optional per-workspace overrides stay on that workspace."
      />
      <PlatformVaultPanel
        section={platformSection}
        inferenceSub={inferenceSub}
        onSectionChange={onSectionChange}
        onInferenceSubChange={onInferenceSubChange}
      />
    </Page>
  );
}

function PlatformVaultPanel({
  section,
  inferenceSub,
  onSectionChange,
  onInferenceSubChange,
}: {
  section: PlatformVaultSection;
  inferenceSub: VaultInferenceSub;
  onSectionChange: (value: string) => void;
  onInferenceSubChange: (value: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" />
          Platform Vault
        </CardTitle>
        <CardDescription>
          Shared platform credentials for this workspace. Personal connects
          (GitHub, wallets and accounts, marketplace) stay on{" "}
          <Link
            to={VAULT_PATH}
            className="text-primary underline-offset-2 hover:underline"
          >
            Personal Vault
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={section} onValueChange={onSectionChange} className="w-full">
          <TabsList variant="line" className="w-full flex-wrap justify-start">
            <TabsTrigger value="cloud">GodMode Cloud</TabsTrigger>
            <TabsTrigger value="inference">Inference</TabsTrigger>
            <TabsTrigger value="secrets">All Secrets</TabsTrigger>
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
              <AccountDeletionCard />
            </section>
          </TabsContent>
          <TabsContent value="inference" className="mt-4">
            <InferenceTab
              sub={inferenceSub}
              onSubChange={onInferenceSubChange}
            />
          </TabsContent>
          <TabsContent value="secrets" className="mt-4">
            <AiSecretsCard vaultScope={{ ownerKind: "platform" }} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
