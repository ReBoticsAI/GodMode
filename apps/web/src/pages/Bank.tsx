import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Settings2Icon } from "lucide-react";
import { Page, PageHeader } from "@/components/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/api";
import { agentVaultHref, userVaultWalletsHref } from "@/lib/navigation";

/** Ledger-only Bank. Wallets & Accounts live under Personal Vault. */
export default function Bank({
  embedded = false,
  agentId = null,
}: {
  embedded?: boolean;
  /** When embedded in an agent panel, deep-link wallets to that Agent Vault. */
  agentId?: string | null;
} = {}) {
  const [searchParams] = useSearchParams();
  const [ledger, setLedger] = useState<Array<Record<string, unknown>>>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);

  const walletsHref = agentId?.trim()
    ? agentVaultHref(agentId.trim(), "wallets")
    : userVaultWalletsHref();

  // Legacy Bank wallet/account deep-links → Platform Vault.
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "wallets" || tab === "accounts") {
      window.location.replace(userVaultWalletsHref());
    }
  }, [searchParams]);

  useEffect(() => {
    api<{ entries: Array<Record<string, unknown>> }>("/bank/ledger")
      .then((r) => setLedger(r.entries ?? []))
      .catch(() => setLedger([]))
      .finally(() => setLedgerLoading(false));
  }, []);

  const body = (
    <Card>
      <CardHeader>
        <CardTitle>Ledger</CardTitle>
        <CardDescription>
          Transaction history across connected wallets and accounts. Connect
          wallets and accounts under Personal Vault → Wallets & Accounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ledgerLoading ? (
          <p className="text-sm text-muted-foreground">Loading ledger…</p>
        ) : ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ledger entries yet. Manual ledger entries are coming soon;
            balances update when you sync live connections or enter balances
            under Personal Vault → Wallets & Accounts.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
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
  );

  if (embedded) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Ledger for this workspace. Manage wallets and accounts in the Personal Vault
            tab.
          </p>
          <Link
            to={walletsHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Settings2Icon data-icon="inline-start" />
            Personal Vault → Wallets & Accounts
          </Link>
        </div>
        {body}
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Bank"
        description="Ledger across connected wallets and accounts. Connect and manage holdings under Personal Vault → Wallets & Accounts."
        actions={
          <Link
            to={userVaultWalletsHref()}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Settings2Icon data-icon="inline-start" />
            Personal Vault → Wallets & Accounts
          </Link>
        }
      />
      {body}
    </Page>
  );
}
