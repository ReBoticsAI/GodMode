import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  fetchGodModeInferenceBilling,
  fetchGodModeInferenceStatus,
  fetchSaasPaywall,
  type GodModeInferencePlan,
  type GodModeInferenceUserStatus,
} from "@/api";
import { CLOUD_MONTHLY_PRICE, CLOUD_YEARLY_PRICE } from "@/lib/cloud-guide";
import {
  canBillEmail,
  startCloudSeatCheckout,
  startInferenceCheckout,
} from "@/lib/inference-checkout";
import type { InferenceOfferKind } from "@/lib/inference-offer";
import { useTenant } from "@/lib/tenant-context";

type CloudPlan = { id: "monthly" | "yearly"; label: string; amountLabel: string };

const FALLBACK_CLOUD_PLANS: CloudPlan[] = [
  { id: "monthly", label: "Cloud Monthly", amountLabel: `${CLOUD_MONTHLY_PRICE}/month` },
  { id: "yearly", label: "Cloud Yearly", amountLabel: `${CLOUD_YEARLY_PRICE}/year` },
];

export function InferenceOfferBilling({
  kind,
  open,
}: {
  kind: InferenceOfferKind;
  open: boolean;
}) {
  const navigate = useNavigate();
  const { user } = useTenant();
  const [status, setStatus] = useState<GodModeInferenceUserStatus | null>(null);
  const [plans, setPlans] = useState<GodModeInferencePlan[]>([]);
  const [paymentsConfigured, setPaymentsConfigured] = useState<boolean | null>(null);
  const [cloudPlans, setCloudPlans] = useState<CloudPlan[]>(FALLBACK_CLOUD_PLANS);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    const accountEmail = user?.email ?? "";
    if (canBillEmail(accountEmail, user?.temporary)) setEmail(accountEmail);
    let cancelled = false;
    void fetchGodModeInferenceBilling()
      .then((config) => {
        if (cancelled) return;
        setPlans(config.plans);
        setPaymentsConfigured(config.paymentsConfigured);
      })
      .catch(() => {
        if (!cancelled) setPaymentsConfigured(false);
      });
    void fetchGodModeInferenceStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      })
      .finally(() => {
        if (!cancelled) setStatusLoaded(true);
      });
    if (kind === "cloud_inference") {
      void fetchSaasPaywall()
        .then((paywall) => {
          if (cancelled) return;
          const next: CloudPlan[] = [];
          for (const plan of paywall.plans) {
            if (plan.id === "monthly" || plan.id === "yearly") {
              next.push({
                id: plan.id,
                label: plan.label,
                amountLabel: plan.amountLabel,
              });
            }
          }
          if (next.length) setCloudPlans(next);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [open, kind, user?.email, user?.temporary]);

  const grant = status?.grant;
  const signedInToBuy = status?.canCheckout === true;
  const remaining =
    grant?.remainingUsd != null
      ? `$${grant.remainingUsd.toFixed(2)} left`
      : grant
        ? "Active"
        : "No active allowance";

  const buyInference = async (planId: string) => {
    if (!signedInToBuy) {
      navigate("/?auth=1");
      return;
    }
    setBusy(planId);
    try {
      await startInferenceCheckout(planId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
      setBusy(null);
    }
  };

  const buyCloud = async (planId: "monthly" | "yearly") => {
    if (!canBillEmail(email, false)) {
      toast.error("Enter the email for the Cloud account");
      return;
    }
    setBusy(planId);
    try {
      await startCloudSeatCheckout(email, planId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
      setBusy(null);
    }
  };

  const inferencePlans =
    plans.length > 0
      ? plans
      : [{ id: "pack", label: "$1 GodMode Inference pack", amountLabel: "$1", priceId: "", interval: "one_time", budgetUsd: 1 }];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage and payment</CardTitle>
        <CardDescription>
          Balance, turns, and Stripe Checkout stay on this window. Checkout returns to GodMode.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={grant?.status === "active" ? "default" : "secondary"}>
            {!statusLoaded ? "Loading usage…" : status ? remaining : "Sign in to see usage"}
          </Badge>
          {grant ? (
            <span className="text-xs text-muted-foreground">
              {grant.kind} · {grant.promptCount} turns · ${grant.spentUsd.toFixed(3)} spent
              {grant.budgetUsd != null ? ` · $${grant.budgetUsd.toFixed(2)} pack` : ""}
            </span>
          ) : null}
        </div>

        {kind === "cloud_inference" ? (
          <div className="flex flex-col gap-2">
            <Field>
              <FieldLabel htmlFor="cloud-checkout-email">Email for Cloud</FieldLabel>
              <Input
                id="cloud-checkout-email"
                type="email"
                autoComplete="email"
                value={email}
                placeholder="you@example.com"
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              {cloudPlans.map((plan) => (
                <Button
                  key={plan.id}
                  type="button"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void buyCloud(plan.id)}
                >
                  {busy === plan.id ? "Opening Stripe…" : `${plan.label} ${plan.amountLabel}`}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">GodMode Inference</p>
          <div className="flex flex-wrap gap-2">
            {inferencePlans.map((plan) => (
              <Button
                key={plan.id}
                type="button"
                size="sm"
                variant={plan.id === "pack" ? "default" : "outline"}
                disabled={Boolean(busy) || paymentsConfigured === false}
                onClick={() => void buyInference(plan.id)}
              >
                {busy === plan.id
                  ? "Opening Stripe…"
                  : signedInToBuy
                    ? plan.amountLabel
                    : `Sign in to buy ${plan.amountLabel}`}
              </Button>
            ))}
          </div>
          {paymentsConfigured === false ? (
            <p className="text-xs text-muted-foreground">
              Stripe is not configured on this instance yet.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
