import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  completeSellerGithubRedirect,
  fetchGithubIntegrationStatus,
  fetchSellerEntitlement,
  fetchSellerGithubRedirectSession,
  startGithubIntegrationConnect,
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

export const SELLER_GITHUB_STATE_KEY = "godmode.sellerGithubState";

/**
 * Cloud page (workspace-optional): connect GitHub on the Seller account via the
 * GodMode Cloud GitHub App, then return to Local (#711).
 */
export default function SellerLinkGithubPage() {
  const [searchParams] = useSearchParams();
  const { user, authenticated } = useTenant();
  const state = (searchParams.get("state") || "").trim();
  const githubFlag = (searchParams.get("github") || "").trim();
  const [busy, setBusy] = useState(false);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [sellerActive, setSellerActive] = useState<boolean | null>(null);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    try {
      sessionStorage.setItem(SELLER_GITHUB_STATE_KEY, state);
    } catch {
      /* ignore */
    }
  }, [state]);

  useEffect(() => {
    if (!state) {
      setError("Missing state. Start again from Local Marketplace → Sell → Connect GitHub.");
      return;
    }
    void fetchSellerGithubRedirectSession(state)
      .then((session) => setReturnUrl(session.returnUrl))
      .catch((err) =>
        setError(userFacingErrorMessage(err, "Seller GitHub session is invalid or expired"))
      );
  }, [state]);

  useEffect(() => {
    if (!authenticated) return;
    void fetchSellerEntitlement()
      .then((ent) => setSellerActive(Boolean(ent.sellerActive)))
      .catch(() => setSellerActive(false));
    void fetchGithubIntegrationStatus()
      .then((st) => setGithubLogin(st.login ?? null))
      .catch(() => setGithubLogin(null));
  }, [authenticated, githubFlag]);

  const finishToLocal = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const result = await completeSellerGithubRedirect(state);
      try {
        sessionStorage.removeItem(SELLER_GITHUB_STATE_KEY);
      } catch {
        /* ignore */
      }
      toast.success("Returning to Local GodMode…");
      window.location.href = result.redirectUrl;
    } catch (err) {
      const msg = userFacingErrorMessage(err, "Could not finish Seller GitHub connect");
      setError(msg);
      toast.error(msg);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!authenticated || sellerActive !== true || !state || busy) return;
    if (githubLogin || githubFlag === "connected") {
      void finishToLocal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when GitHub ready
  }, [authenticated, sellerActive, state, githubLogin, githubFlag]);

  const connectGithub = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const returnPath = `/seller-link/github?state=${encodeURIComponent(state)}`;
      const { url } = await startGithubIntegrationConnect({ returnPath });
      window.location.href = url;
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Could not start GitHub connect"));
      setBusy(false);
    }
  };

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
        successUrl: `${origin}/seller-link/github?state=${encodeURIComponent(state)}&saas_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/seller-link/github?state=${encodeURIComponent(state)}&saas_checkout=cancel`,
      });
      window.location.href = url;
    } catch (err) {
      toast.error(userFacingErrorMessage(err, "Seller checkout failed"));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Connect GitHub for Local Sell</CardTitle>
          <CardDescription>
            Sign in to your GodMode Seller account and connect GitHub with the GodMode Cloud
            GitHub App. Local does not need GitHub App secrets. When finished, you return to
            Local Marketplace.
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
            <>
              <Alert>
                <AlertTitle>Seller seat required</AlertTitle>
                <AlertDescription>
                  Buy or renew the GodMode Seller seat, then connect GitHub on this page.
                </AlertDescription>
              </Alert>
              <Button type="button" disabled={busy} onClick={() => void buySellerSeat()}>
                {busy ? "Opening checkout…" : "Get Seller seat"}
              </Button>
            </>
          ) : githubLogin ? (
            <Alert>
              <AlertTitle>GitHub connected as {githubLogin}</AlertTitle>
              <AlertDescription>Returning you to Local GodMode…</AlertDescription>
            </Alert>
          ) : (
            <Button type="button" disabled={busy} onClick={() => void connectGithub()}>
              {busy ? "Opening GitHub…" : "Connect GitHub"}
            </Button>
          )}
          {authenticated && sellerActive && githubLogin ? (
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
