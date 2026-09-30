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

type CloudPlan = {
  id: string;
  label: string;
  amountLabel: string;
  includedInferenceBudgetUsd?: number;
};

const FALLBACK_BYOK_PLANS: CloudPlan[] = [
  { id: "monthly", label: "Cloud Monthly", amountLabel: `${CLOUD_MONTHLY_PRICE}/month` },
  { id: "yearly", label: "Cloud Yearly", amountLabel: `${CLOUD_YEARLY_PRICE}/year` },
];

const FALLBACK_BUNDLE_PLANS: CloudPlan[] = [
  {
    id: "monthly_inference",
    label: "Cloud with Inference",
    amountLabel: "$12.99/month",
    includedInferenceBudgetUsd: 5,
  },
  {
    id: "monthly_inference_plus",
    label: "Cloud with Inference Plus",
    amountLabel: "$17.99/month",
    includedInferenceBudgetUsd: 10,
  },
  {
    id: "monthly_inference_pro",
    label: "Cloud with Inference Pro",
    amountLabel: "$29.99/month",
    includedInferenceBudgetUsd: 25,
  },
];

const FALLBACK_PACKS: GodModeInferencePlan[] = [
  { id: "pack_5", label: "$5 pack", amountLabel: "$5", priceId: "", interval: "one_time", budgetUsd: 5 },
  { id: "pack_10", label: "$10 pack", amountLabel: "$10", priceId: "", interval: "one_time", budgetUsd: 10 },
  { id: "pack_25", label: "$25 pack", amountLabel: "$25", priceId: "", interval: "one_time", budgetUsd: 25 },
  { id: "pack_50", label: "$50 pack", amountLabel: "$50", priceId: "", interval: "one_time", budgetUsd: 50 },
  { id: "pack_100", label: "$100 pack", amountLabel: "$100", priceId: "", interval: "one_time", budgetUsd: 100 },
];

function isInferenceBundlePlanId(id: string): boolean {
  return id.includes("inference") && id !== "seller";
}

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
  const [bundlePlans, setBundlePlans] = useState<CloudPlan[]>(FALLBACK_BUNDLE_PLANS);
  const [byokPlans, setByokPlans] = useState<CloudPlan[]>(FALLBACK_BYOK_PLANS);
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
          const bundles: CloudPlan[] = [];
          const byok: CloudPlan[] = [];
          for (const plan of paywall.plans) {
            const row: CloudPlan = {
              id: plan.id,
              label: plan.label,
              amountLabel: plan.amountLabel,
              includedInferenceBudgetUsd: plan.includedInferenceBudgetUsd,
            };
            if (isInferenceBundlePlanId(plan.id)) bundles.push(row);
            else if (plan.id === "monthly" || plan.id === "yearly") byok.push(row);
          }
          if (bundles.length) setBundlePlans(bundles);
          if (byok.length) setByokPlans(byok);
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

  const buyCloudPlan = async (planId: string) => {
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

  const inferencePlans = plans.length > 0 ? plans : FALLBACK_PACKS;

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
              {grant.budgetUsd != null ? ` · $${grant.budgetUsd.toFixed(2)} credit` : ""}
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
            <p className="text-xs font-medium">Cloud with Inference (seat + credit)</p>
            <div className="flex flex-wrap gap-2">
              {bundlePlans.map((plan) => (
                <Button
                  key={plan.id}
                  type="button"
                  variant={plan.id === "monthly_inference" ? "default" : "outline"}
                  disabled={Boolean(busy)}
                  onClick={() => void buyCloudPlan(plan.id)}
                >
                  {busy === plan.id
                    ? "Opening Stripe…"
                    : `${plan.label} ${plan.amountLabel}${
                        plan.includedInferenceBudgetUsd
                          ? ` · $${plan.includedInferenceBudgetUsd} credit`
                          : ""
                      }`}
                </Button>
              ))}
            </div>
            <p className="text-xs font-medium text-muted-foreground">Cloud only (BYOK)</p>
            <div className="flex flex-wrap gap-2">
              {byokPlans.map((plan) => (
                <Button
                  key={plan.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void buyCloudPlan(plan.id)}
                >
                  {busy === plan.id ? "Opening Stripe…" : `${plan.label} ${plan.amountLabel}`}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">
            {kind === "cloud_inference" ? "Top up Inference packs" : "GodMode Inference packs"}
          </p>
          <div className="flex flex-wrap gap-2">
            {inferencePlans.map((plan) => (
              <Button
                key={plan.id}
                type="button"
                size="sm"
                variant={plan.id === "pack_10" ? "default" : "outline"}
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
