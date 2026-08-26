import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  completeSellerLinkRedirect,
  fetchSellerEntitlement,
  fetchSellerLinkRedirectSession,
  startSaasCheckout,
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

export const SELLER_LINK_STATE_KEY = "godmode.sellerLinkState";

/**
 * Cloud-only page: finish Local Seller bind after signup / signin / Seller checkout,
 * then redirect back to Local with a one-time exchange code.
 */
export default function SellerLinkConnectPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, authenticated, refresh } = useTenant();
  const state = (searchParams.get("state") || "").trim();
  const [busy, setBusy] = useState(false);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [sellerActive, setSellerActive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state) {
      try {
        sessionStorage.setItem(SELLER_LINK_STATE_KEY, state);
      } catch {
        /* ignore */
      }
    }
  }, [state]);

  useEffect(() => {
    if (!state) {
      setError("Missing seller link state. Start again from Local Marketplace → Sell.");
      return;
    }
    void fetchSellerLinkRedirectSession(state)
      .then((session) => setReturnUrl(session.returnUrl))
      .catch((err) =>
        setError(userFacingErrorMessage(err, "Seller link session is invalid or expired"))
      );
  }, [state]);

  useEffect(() => {
    if (!authenticated) return;
    void fetchSellerEntitlement()
      .then((ent) => setSellerActive(Boolean(ent.sellerActive)))
      .catch(() => setSellerActive(false));
  }, [authenticated]);

  const finishToLocal = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const result = await completeSellerLinkRedirect(state);
      try {
        sessionStorage.removeItem(SELLER_LINK_STATE_KEY);
      } catch {
        /* ignore */
      }
      toast.success("Returning to Local GodMode…");
      window.location.href = result.redirectUrl;
    } catch (err) {
      const msg = userFacingErrorMessage(err, "Could not finish Seller link");
      setError(msg);
      toast.error(msg);
      if (String(msg).toLowerCase().includes("not active")) {
        setSellerActive(false);
      }
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!authenticated || sellerActive !== true || !state || busy) return;
    void finishToLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when seat becomes active
  }, [authenticated, sellerActive, state]);

  const buySellerSeat = async () => {
    if (!user?.email) {
      toast.error("Sign in first");
      return;
    }
    setBusy(true);
    try {
      const origin = window.location.origin;
      const { url } = await startSaasCheckout({
        email: user.email,
        plan: "seller",
        successUrl: `${origin}/seller-link/connect?state=${encodeURIComponent(state)}&saas_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/seller-link/connect?state=${encodeURIComponent(state)}&saas_checkout=cancel`,
      });
      window.location.href = url;
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Seller checkout failed"));
      setBusy(false);
    }
  };

  useEffect(() => {
    const checkout = searchParams.get("saas_checkout");
    if (checkout !== "success" || !authenticated) return;
    setBusy(true);
    void refresh()
      .then(() => fetchSellerEntitlement())
      .then((ent) => {
        setSellerActive(Boolean(ent.sellerActive));
        if (!ent.sellerActive) {
          toast.message("Payment received. Waiting for Seller seat to activate…");
        }
      })
      .catch((err) => toast.error(userFacingErrorMessage(err, "Could not refresh Seller seat")))
      .finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete("saas_checkout");
        next.delete("session_id");
        setSearchParams(next, { replace: true });
        setBusy(false);
      });
  }, [searchParams, authenticated, refresh, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("saas_checkout") !== "cancel") return;
    toast.message("Checkout canceled");
    const next = new URLSearchParams(searchParams);
    next.delete("saas_checkout");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Connect Local GodMode Seller</CardTitle>
          <CardDescription>
            Sign in or buy a GodMode Seller seat (~$4.99/mo). When ready, you return to Local
            Marketplace to sell. Cloud is only for account and payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Seller link</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {returnUrl ? (
            <p className="text-sm text-muted-foreground">
              After linking, you return to your Local install.
            </p>
          ) : null}
          {!authenticated ? (
            <Alert>
              <AlertTitle>Sign in required</AlertTitle>
              <AlertDescription>
                Use the Cloud sign-in form. After you authenticate, this page continues the Local
                link automatically.
              </AlertDescription>
            </Alert>
          ) : sellerActive === false ? (
            <>
              <Alert>
                <AlertTitle>GodMode Seller seat needed</AlertTitle>
                <AlertDescription>
                  Your Cloud account is signed in, but Seller commerce is not active yet.
                </AlertDescription>
              </Alert>
              <Button type="button" onClick={() => void buySellerSeat()} disabled={busy}>
                {busy ? "Starting checkout…" : "Buy GodMode Seller (~$4.99/mo)"}
              </Button>
            </>
          ) : sellerActive === true ? (
            <p className="text-sm text-muted-foreground">
              {busy ? "Returning to Local…" : "Seller seat active. Finishing link…"}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Checking Seller seat…</p>
          )}
          <Button type="button" variant="outline" onClick={() => navigate("/")}>
            Cancel
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
