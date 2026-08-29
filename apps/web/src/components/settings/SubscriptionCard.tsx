import { useEffect, useState } from "react";
import { CreditCardIcon, ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";
import {
  fetchBridgeHealth,
  fetchSaasSubscription,
  startSaasBillingPortal,
  type SaasSubscriptionPublic,
} from "@/api";
import { platformVaultSettingsHref } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function formatPeriodEnd(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SubscriptionCard() {
  const [saas, setSaas] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [sub, setSub] = useState<SaasSubscriptionPublic | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const health = await fetchBridgeHealth();
        if (cancelled) return;
        const enabled = Boolean(health.saas);
        setSaas(enabled);
        if (!enabled) {
          setLoading(false);
          return;
        }
        const result = await fetchSaasSubscription();
        if (!cancelled) setSub(result.subscription);
      } catch {
        if (!cancelled) setSaas(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!saas) return null;

  const openPortal = async () => {
    setOpening(true);
    try {
      const { url } = await startSaasBillingPortal({
        returnUrl: `${window.location.origin}${platformVaultSettingsHref("cloud")}`,
      });
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal");
      setOpening(false);
    }
  };

  const pastDue = sub?.status === "past_due";
  const revoked = Boolean(sub?.accessRevoked);
  const daysLeft = sub?.graceDaysRemaining ?? null;
  const inGrace = pastDue && !revoked && daysLeft !== null && daysLeft > 0;
  const graceExpired = pastDue && (revoked || daysLeft === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
        <CardDescription>
          Manage your GodMode Cloud plan, payment method, and billing in Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading subscription…
          </div>
        ) : sub ? (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {sub.planLabel ?? "GodMode Cloud"}
                {sub.amountLabel ? ` · ${sub.amountLabel}` : ""}
              </span>
              {sub.status ? (
                <Badge variant="secondary">{sub.status.replace(/_/g, " ")}</Badge>
              ) : null}
              {sub.cancelAtPeriodEnd ? (
                <Badge variant="outline">Cancels at period end</Badge>
              ) : null}
            </div>
            {formatPeriodEnd(sub.currentPeriodEnd) ? (
              <p className="text-muted-foreground">
                Current period ends {formatPeriodEnd(sub.currentPeriodEnd)}
              </p>
            ) : null}
            {inGrace ? (
              <Alert>
                <AlertTitle>Payment past due</AlertTitle>
                <AlertDescription>
                  Update your payment method in the billing portal. Cloud access continues for{" "}
                  {daysLeft === 1 ? "1 more day" : `${daysLeft} more days`}, then pauses until
                  payment succeeds.
                </AlertDescription>
              </Alert>
            ) : null}
            {graceExpired ? (
              <Alert variant="destructive">
                <AlertTitle>Access paused</AlertTitle>
                <AlertDescription>
                  The past-due grace period has ended. Renew in the billing portal to restore
                  GodMode Cloud.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No subscription details are linked to this account yet.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={opening || loading || (sub ? !sub.hasCustomer : false)}
          onClick={() => void openPortal()}
        >
          <CreditCardIcon data-icon="inline-start" />
          {opening ? "Opening…" : "Open billing portal"}
          <ExternalLinkIcon data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  );
}
