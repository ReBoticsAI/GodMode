import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import {
  completeGodModeInferenceCheckout,
  fetchGodModeInferenceStatus,
  type GodModeInferenceUserStatus,
} from "@/api";
import { openInferenceOffer } from "@/lib/inference-offer";

/** Balance chip on the Graph composer. Opens the Inference window. */
export function InferenceComposerChip() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<GodModeInferenceUserStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchGodModeInferenceStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    const paid = params.get("inference");
    if (paid !== "paid" && paid !== "cancel") return;
    const sessionId = params.get("session_id")?.trim() ?? "";
    const next = new URLSearchParams(params);
    next.delete("inference");
    next.delete("session_id");
    setParams(next, { replace: true });
    if (paid !== "paid") return;
    if (!sessionId) {
      toast.success("GodMode Inference payment returned. Balance updates after Stripe confirms it.");
      return;
    }
    void completeGodModeInferenceCheckout(sessionId)
      .then((result) => {
        const left =
          result.remainingUsd != null ? `$${result.remainingUsd.toFixed(2)} left.` : "";
        toast.success(`GodMode Inference pack applied. ${left}`.trim());
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Could not apply Inference payment");
      });
  }, [params, setParams]);

  const grant = status?.grant;
  const label =
    grant?.remainingUsd != null
      ? `$${grant.remainingUsd.toFixed(2)} left`
      : "Inference";
  const detail = grant
    ? `${grant.promptCount} turns, $${grant.spentUsd.toFixed(3)} spent`
    : "Open GodMode Inference usage";

  return (
    <button
      type="button"
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/50 bg-card/80 px-2.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
      aria-label={`GodMode Inference. ${label}. ${detail}`}
      onClick={() => openInferenceOffer("inference")}
    >
      <SparklesIcon className="size-3.5" />
      <span>{label}</span>
    </button>
  );
}
