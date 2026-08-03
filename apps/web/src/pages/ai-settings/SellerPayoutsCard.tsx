import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { StoreIcon } from "lucide-react";
import { toast } from "sonner";
import {
  acceptMarketplaceTos,
  connectMarketplacePayout,
  fetchMarketplaceCommerceConfig,
  refreshMarketplaceStripeConnect,
  startMarketplaceStripeConnect,
} from "@/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type SellerPayoutsStatus = {
  payoutReady: boolean;
  stripeConnectId: string;
  tosAccepted: boolean;
};

export type SellerPayoutsCardProps = {
  /** Full Stripe Connect return URL (must include stripe_connect=return). */
  returnUrl: string;
  /** Full Stripe Connect refresh URL (must include stripe_connect=refresh). */
  refreshUrl: string;
  onStatusChange?: (status: SellerPayoutsStatus) => void;
};

function applyConnectRow(row: Record<string, unknown>): {
  stripeConnectId: string;
  payoutReady: boolean;
} {
  const stripeConnectId = String(row.stripe_connect_account_id ?? "");
  const ready =
    row.onboarding_status === "ready" ||
    row.stripe_payouts_enabled === true ||
    row.stripe_payouts_enabled === 1;
  return {
    stripeConnectId,
    payoutReady: Boolean(ready) || Boolean(stripeConnectId),
  };
}

/**
 * Marketplace seller Stripe Connect + advanced payout fields.
 * Connect home: Vault → Marketplace. Marketplace → Sell links here.
 */
export function SellerPayoutsCard({
  returnUrl,
  refreshUrl,
  onStatusChange,
}: SellerPayoutsCardProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stripeConnectId, setStripeConnectId] = useState("");
  const [paypalMerchantId, setPaypalMerchantId] = useState("");
  const [metamaskAddress, setMetamaskAddress] = useState("");
  const [payoutReady, setPayoutReady] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [platformFeeBps, setPlatformFeeBps] = useState(1000);
  const [busy, setBusy] = useState(false);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  const tosAcceptedRef = useRef(tosAccepted);
  tosAcceptedRef.current = tosAccepted;

  const notify = (next: {
    stripeConnectId: string;
    payoutReady: boolean;
    tosAccepted?: boolean;
  }) => {
    onStatusChangeRef.current?.({
      stripeConnectId: next.stripeConnectId,
      payoutReady: next.payoutReady,
      tosAccepted: next.tosAccepted ?? tosAcceptedRef.current,
    });
  };

  useEffect(() => {
    void fetchMarketplaceCommerceConfig()
      .then((cfg) => setPlatformFeeBps(cfg.platformFeeBps))
      .catch(() => undefined);
    void (async () => {
      try {
        const row = await refreshMarketplaceStripeConnect();
        const applied = applyConnectRow(row);
        setStripeConnectId(applied.stripeConnectId);
        setPayoutReady(applied.payoutReady);
        notify(applied);
      } catch {
        // No seller account yet is fine; leave empty until Connect.
      }
    })();
  }, []);

  useEffect(() => {
    const stripeConnect = searchParams.get("stripe_connect");
    if (stripeConnect !== "return" && stripeConnect !== "refresh") return;

    void (async () => {
      try {
        const row = await refreshMarketplaceStripeConnect();
        const applied = applyConnectRow(row);
        setStripeConnectId(applied.stripeConnectId);
        setPayoutReady(applied.payoutReady);
        notify(applied);
        if (
          row.onboarding_status === "ready" ||
          row.stripe_payouts_enabled === true ||
          row.stripe_payouts_enabled === 1
        ) {
          toast.success("Stripe Connect is ready for payouts");
        } else if (stripeConnect === "refresh") {
          toast.message("Stripe onboarding incomplete. Click Connect with Stripe to continue.");
        } else {
          toast.message(
            "Stripe onboarding saved. If payouts are not enabled yet, finish verification in Stripe."
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not refresh Stripe Connect");
      } finally {
        const next = new URLSearchParams(searchParams);
        next.delete("stripe_connect");
        setSearchParams(next, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams]);

  const handleStripeConnectOnboarding = async () => {
    setBusy(true);
    try {
      await acceptMarketplaceTos();
      setTosAccepted(true);
      const result = await startMarketplaceStripeConnect({ returnUrl, refreshUrl });
      if (result.accountId) {
        setStripeConnectId(result.accountId);
        notify({
          stripeConnectId: result.accountId,
          payoutReady,
          tosAccepted: true,
        });
      } else {
        notify({ stripeConnectId, payoutReady, tosAccepted: true });
      }
      window.location.assign(result.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stripe Connect onboarding failed");
      setBusy(false);
    }
  };

  const handleConnectPayout = async () => {
    setBusy(true);
    try {
      await acceptMarketplaceTos();
      setTosAccepted(true);
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
      const ready = Boolean(
        stripeConnectId.trim() || paypalMerchantId.trim() || metamaskAddress.trim()
      );
      setPayoutReady(ready);
      notify({
        stripeConnectId: stripeConnectId.trim(),
        payoutReady: ready,
        tosAccepted: true,
      });
      toast.success(
        `Seller payout methods saved (${(platformFeeBps / 100).toFixed(0)}% platform fee on sales)`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save payout methods");
    } finally {
      setBusy(false);
    }
  };

  const feePercent = (platformFeeBps / 100).toFixed(0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <StoreIcon className="size-4" />
          Seller payouts
        </CardTitle>
        <CardDescription>
          Connect Stripe for Community sales (recommended). Platform fee is {feePercent}%.
          Official ReBotics catalog sales are separate (100% to platform). PayPal/crypto are
          deferred for v1.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => void handleStripeConnectOnboarding()}
          >
            Connect with Stripe
          </Button>
          {stripeConnectId ? (
            <p className="text-xs text-muted-foreground">
              Linked Connect account: {stripeConnectId}
              {payoutReady ? " (ready)" : " (finish onboarding if prompted)"}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <Label>Stripe Connect account id (advanced)</Label>
          <Input
            value={stripeConnectId}
            onChange={(e) => setStripeConnectId(e.target.value)}
            placeholder="acct_… (optional paste fallback)"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>PayPal merchant id (later)</Label>
          <Input
            value={paypalMerchantId}
            onChange={(e) => setPaypalMerchantId(e.target.value)}
            placeholder="PayPal merchant id"
            disabled
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label>MetaMask address (later)</Label>
          <Input
            value={metamaskAddress}
            onChange={(e) => setMetamaskAddress(e.target.value)}
            placeholder="0x…"
            disabled
          />
        </div>
        <Button
          type="button"
          className="w-fit"
          variant="outline"
          disabled={busy}
          onClick={() => void handleConnectPayout()}
        >
          Save advanced payout fields
        </Button>
      </CardContent>
    </Card>
  );
}
