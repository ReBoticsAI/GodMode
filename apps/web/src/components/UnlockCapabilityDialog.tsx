import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ChatUnlockStatus } from "@/api";
import { useMemo, useState } from "react";

type UnlockableRow = ChatUnlockStatus["unlockables"][number];

const STEP_LABELS: Record<string, string> = {
  open_chat: "Open the Intelligence chat panel",
  send_message: "Send a message in chat",
  acknowledge_graph: "Acknowledge that closing docks Chat onto the graph",
  confirm_controls: "Confirm you understand X and resize after unlock",
  open_history: "Open chat history / thread list",
  acknowledge_threads: "Acknowledge that + creates a new thread",
  confirm_create: "Confirm you understand create-chat after unlock",
};

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function UnlockCapabilityDialog({
  open,
  unlockable,
  authenticated,
  canAdminGrant,
  mode,
  onOpenChange,
  onStartTutorial,
  onToggleStep,
  onCompleteTutorial,
  onSkipPay,
  onAdminGrant,
}: {
  open: boolean;
  unlockable: UnlockableRow | null;
  authenticated: boolean;
  canAdminGrant?: boolean;
  mode: "choose" | "tutorial";
  onOpenChange: (open: boolean) => void;
  onStartTutorial: () => Promise<void>;
  onToggleStep: (step: string, done: boolean) => Promise<void>;
  onCompleteTutorial: () => Promise<void>;
  onSkipPay: () => Promise<void>;
  onAdminGrant?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const price = unlockable
    ? formatUsd(unlockable.skip_price_cents)
    : "";

  const steps = unlockable?.tutorialSteps ?? [];
  const progress = unlockable?.tutorialProgress ?? {};
  const allDone = useMemo(
    () => steps.length > 0 && steps.every((s) => progress[s]),
    [steps, progress]
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const canAct = authenticated || Boolean(canAdminGrant);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {unlockable?.label ?? "Unlock capability"}
          </DialogTitle>
          <DialogDescription>
            {unlockable?.description ??
              "Finish the free tutorial, or pay to skip it."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Every GodMode unlock is free via its tutorial. Paying only skips the
          tutorial. This is separate from GodMode Cloud and Seller seats.
        </p>
        {!canAct ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Sign in or create an account first, then return here to unlock.
          </p>
        ) : null}

        {mode === "tutorial" && canAct ? (
          <ul className="flex flex-col gap-3">
            {steps.map((step) => {
              const checked = Boolean(progress[step]);
              const id = `unlock-step-${step}`;
              return (
                <li key={step} className="flex items-start gap-2">
                  <Checkbox
                    id={id}
                    checked={checked}
                    disabled={busy}
                    onCheckedChange={(v) => {
                      void run(() => onToggleStep(step, v === true));
                    }}
                  />
                  <Label htmlFor={id} className="text-sm font-normal leading-snug">
                    {STEP_LABELS[step] ?? step}
                  </Label>
                </li>
              );
            })}
          </ul>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {mode === "choose" ? (
            <>
              <Button
                type="button"
                disabled={!canAct || busy}
                onClick={() => void run(onStartTutorial)}
              >
                Do the tutorial (free). Intelligence will guide you.
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canAct || busy}
                onClick={() => void run(onSkipPay)}
              >
                Skip for {price} (not required)
              </Button>
              {canAdminGrant && onAdminGrant ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canAct || busy}
                  onClick={() => void run(onAdminGrant)}
                >
                  Admin grant (skip tutorial)
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              type="button"
              disabled={!canAct || busy || !allDone}
              onClick={() => void run(onCompleteTutorial)}
            >
              Complete tutorial and unlock
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
