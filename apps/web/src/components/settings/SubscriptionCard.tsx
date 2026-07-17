import { useEffect, useState } from "react";
import { CreditCardIcon, ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";
import {
  fetchBridgeHealth,
  fetchSaasSubscription,
  startSaasBillingPortal,
  type SaasSubscriptionPublic,
} from "@/api";
import { SETTINGS_PATH } from "@/lib/navigation";
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
        returnUrl: `${window.location.origin}${SETTINGS_PATH}`,
      });
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing portal");
      setOpening(false);
    }
  };

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
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No subscription details are linked to this account yet.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={opening || (sub ? !sub.hasCustomer : true)}
          onClick={() => void openPortal()}
          className="w-fit"
        >
          {opening ? (
            <Spinner className="size-4" data-icon="inline-start" />
          ) : (
            <CreditCardIcon data-icon="inline-start" />
          )}
          Manage subscription
          <ExternalLinkIcon className="size-3.5 opacity-70" data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  );
}
