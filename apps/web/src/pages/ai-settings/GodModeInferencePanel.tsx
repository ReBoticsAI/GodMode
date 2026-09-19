import { useCallback, useEffect, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchGodModeInferenceStatus,
  createGodModeInferenceCheckout,
  type GodModeInferenceUserStatus,
} from "@/api";

/**
 * Managed GodMode Inference balance + $1 pack / subscription ladder.
 */
export function GodModeInferencePanel() {
  const [status, setStatus] = useState<GodModeInferenceUserStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchGodModeInferenceStatus()
      .then(setStatus)
      .catch((err) => {
        console.error(err);
        toast.error(
          err instanceof Error ? err.message : "Failed to load GodMode Inference"
        );
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checkout = async (planId: string) => {
    setBusy(planId);
    try {
      const session = await createGodModeInferenceCheckout(planId);
      if (session.url) {
        window.location.href = session.url;
        return;
      }
      toast.error("Checkout did not return a URL");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(null);
    }
  };

  const grant = status?.grant;
  const remaining =
    grant?.remainingUsd != null
      ? `$${grant.remainingUsd.toFixed(2)} left`
      : grant
        ? "Active"
        : "No active allowance";

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium">GodMode Inference</h2>
        <p className="text-sm text-muted-foreground">
          Managed Intelligence chat on DeepSeek, Z.AI, and Qwen under GodMode
          accounts. Buy a $1 pack or subscribe through the same GodMode Cloud
          Stripe billing used for seats. Not a vendor partnership claim. For your
          own keys, use Supported BYOK. Local models stay available.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4" />
            Your allowance
          </CardTitle>
          <CardDescription>
            Free welcome guide, then packs and subscriptions top up the same
            managed balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={grant?.status === "active" ? "default" : "secondary"}>
              {remaining}
            </Badge>
            {grant ? (
              <span className="text-xs text-muted-foreground">
                {grant.kind} · {grant.promptCount} turns · $
                {grant.spentUsd.toFixed(3)} spent
              </span>
            ) : null}
            {!status?.supplyReady ? (
              <Badge variant="outline">Supply not configured on this instance</Badge>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium">Buy more</p>
            <div className="flex flex-wrap gap-2">
              {(status?.plans ?? [{ id: "pack", label: "$1 pack", amountLabel: "$1" }]).map(
                (plan) => (
                  <Button
                    key={plan.id}
                    type="button"
                    size="sm"
                    variant={plan.id === "pack" ? "default" : "outline"}
                    disabled={Boolean(busy) || !status?.paymentsConfigured}
                    onClick={() => void checkout(plan.id)}
                  >
                    {busy === plan.id
                      ? "Opening…"
                      : plan.id === "pack"
                        ? "Buy $1 pack"
                        : plan.label}
                  </Button>
                )
              )}
            </div>
            {!status?.paymentsConfigured ? (
              <p className="text-xs text-muted-foreground">
                Stripe is not configured on this instance yet. On GodMode Cloud,
                Admin → Billing uses the same STRIPE_SECRET_KEY / webhook as
                seats. Or use Supported BYOK / Local models.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
