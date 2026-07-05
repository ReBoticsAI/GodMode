import { useEffect, useState } from "react";
import { Settings2Icon } from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HoldingsConnectionsContent } from "@/pages/Holdings";
import type { HoldingCategory } from "@/lib/api-holdings";
import { api } from "@/api";

const WALLET_CATEGORIES: HoldingCategory[] = ["wallet", "exchange"];
const ACCOUNT_CATEGORIES: HoldingCategory[] = ["bank", "paypal", "manual"];

export default function Bank() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [ledger, setLedger] = useState<Array<Record<string, unknown>>>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);

  useEffect(() => {
    api<{ entries: Array<Record<string, unknown>> }>("/bank/ledger")
      .then((r) => setLedger(r.entries ?? []))
      .catch(() => setLedger([]))
      .finally(() => setLedgerLoading(false));
  }, []);

  return (
    <Page>
      <PageHeader
        title="Bank"
        description="Connect wallets and accounts so you and your agents can track balances and transactions."
        actions={
          <Button variant="outline" size="sm" onClick={() => setSetupOpen(true)}>
            <Settings2Icon data-icon="inline-start" />
            Integration setup
          </Button>
        }
      />

      <Tabs defaultValue="wallets" className="w-full">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="wallets">Wallets</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="wallets" className="mt-4 flex flex-col gap-4">
          <HoldingsConnectionsContent
            categoryFilter={WALLET_CATEGORIES}
            setupOpen={setupOpen}
            onSetupOpenChange={setSetupOpen}
          />
        </TabsContent>

        <TabsContent value="accounts" className="mt-4 flex flex-col gap-4">
          <HoldingsConnectionsContent
            categoryFilter={ACCOUNT_CATEGORIES}
            setupOpen={setupOpen}
            onSetupOpenChange={setSetupOpen}
          />
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Ledger</CardTitle>
              <CardDescription>
                Transaction history across connected wallets and accounts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ledgerLoading ? (
                <p className="text-sm text-muted-foreground">Loading ledger…</p>
              ) : ledger.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No ledger entries yet. Manual ledger entries are coming soon;
                  balances on the Wallets and Accounts tabs update when you sync
                  live connections or enter balances manually.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {ledger.map((row) => (
                    <li
                      key={String(row.id)}
                      className="flex justify-between gap-4 border-b border-border/50 pb-2"
                    >
                      <span>{String(row.label ?? row.category ?? "Entry")}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {String(row.amount)} {String(row.currency ?? "USD")}
                      </span>
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
