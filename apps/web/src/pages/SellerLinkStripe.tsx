import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  completeSellerStripeRedirect,
  fetchSellerEntitlement,
  fetchSellerStripeRedirectSession,
  refreshSellerStripeConnect,
  startSellerStripeConnect,
} from "@/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTenant } from "@/lib/tenant-context";
import { userFacingErrorMessage } from "@/lib/marketplace-format";

export const SELLER_STRIPE_STATE_KEY = "godmode.sellerStripeState";

/**
 * Cloud page (workspace-optional): Stripe Connect on the Seller account, then
 * return to Local (#709).
 */
export default function SellerLinkStripePage() {
  const [searchParams] = useSearchParams();
  const { authenticated } = useTenant();
  const state = (searchParams.get("state") || "").trim();
  const stripeFlag = (searchParams.get("stripe_connect") || "").trim();
  const [busy, setBusy] = useState(false);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [sellerActive, setSellerActive] = useState<boolean | null>(null);
  const [stripePayoutReady, setStripePayoutReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    try {
      sessionStorage.setItem(SELLER_STRIPE_STATE_KEY, state);
    } catch {
      /* ignore */
    }
  }, [state]);

  useEffect(() => {
    if (!state) {
      setError("Missing state. Start again from Local Marketplace → Sell → Connect Stripe.");
      return;
    }
    void fetchSellerStripeRedirectSession(state)
      .then((session) => setReturnUrl(session.returnUrl))
      .catch((err) =>
        setError(userFacingErrorMessage(err, "Seller Stripe session is invalid or expired"))
      );
  }, [state]);

  const reloadEntitlement = async () => {
    const ent = await fetchSellerEntitlement();
    setSellerActive(Boolean(ent.sellerActive));
    setStripePayoutReady(Boolean(ent.stripePayoutReady));
    return ent;
  };

  useEffect(() => {
    if (!authenticated) return;
    void reloadEntitlement().catch(() => {
      setSellerActive(false);
      setStripePayoutReady(false);
    });
  }, [authenticated]);

  const finishToLocal = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const result = await completeSellerStripeRedirect(state);
      try {
        sessionStorage.removeItem(SELLER_STRIPE_STATE_KEY);
      } catch {
        /* ignore */
      }
      toast.success("Returning to Local GodMode…");
      window.location.href = result.redirectUrl;
    } catch (err) {
      const msg = userFacingErrorMessage(err, "Could not finish Seller Stripe connect");
      setError(msg);
      toast.error(msg);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!authenticated || sellerActive !== true || !state || busy) return;
    if (stripeFlag !== "return" && stripeFlag !== "refresh") return;
    void (async () => {
      setBusy(true);
      try {
        await refreshSellerStripeConnect();
        const ent = await reloadEntitlement();
        if (ent.stripePayoutReady) {
          await finishToLocal();
        } else if (stripeFlag === "refresh") {
          toast.message("Stripe onboarding incomplete. Continue setup to finish verification.");
        } else {
          toast.message(
            "Stripe account linked. If payouts are not enabled yet, continue verification in Stripe."
          );
        }
      } catch (err) {
        toast.error(userFacingErrorMessage(err, "Could not refresh Stripe Connect"));
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on Stripe return
  }, [authenticated, sellerActive, state, stripeFlag]);

  useEffect(() => {
    if (!authenticated || sellerActive !== true || !state || busy) return;
    if (stripePayoutReady && !stripeFlag) {
      void finishToLocal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when Stripe ready
  }, [authenticated, sellerActive, state, stripePayoutReady, stripeFlag]);

  const connectStripe = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const result = await startSellerStripeConnect(state);
      window.location.href = result.url;
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Could not start Stripe Connect"));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Connect Stripe for Local Sell</CardTitle>
          <CardDescription>
            Sign in to your GodMode Seller account and connect Stripe Connect for Community
            payouts. When finished, you return to Local Marketplace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not continue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {returnUrl ? (
            <p className="text-sm text-muted-foreground">
              After connect, return to:{" "}
              <span className="break-all font-mono text-xs text-foreground">{returnUrl}</span>
            </p>
          ) : null}
          {!authenticated ? (
            <Alert>
              <AlertTitle>Sign in required</AlertTitle>
              <AlertDescription>
                Use the sign-in form for your GodMode Seller account (commerce only; no Cloud
                workspace required).
              </AlertDescription>
            </Alert>
          ) : sellerActive === false ? (
            <Alert>
              <AlertTitle>Seller seat required</AlertTitle>
              <AlertDescription>
                Buy or renew the GodMode Seller seat, then connect Stripe on this page.
              </AlertDescription>
            </Alert>
          ) : stripePayoutReady ? (
            <Alert>
              <AlertTitle>Stripe Connect linked</AlertTitle>
              <AlertDescription>Returning you to Local GodMode…</AlertDescription>
            </Alert>
          ) : (
            <Button type="button" disabled={busy} onClick={() => void connectStripe()}>
              {busy ? "Opening Stripe…" : "Connect with Stripe"}
            </Button>
          )}
          {authenticated && sellerActive && stripePayoutReady ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void finishToLocal()}
            >
              Return to Local now
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
