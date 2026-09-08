import { useEffect, useRef, useState } from "react";
import { IntelligencePanel } from "@/components/intelligence/IntelligencePanel";
import { InformationFloatingPanel } from "@/components/intelligence/InformationFloatingPanel";
import { ChatGraphCanvas } from "@/components/ChatGraphCanvas";
import { Toaster } from "@/components/ui/sonner";
import {
  ensureTrialInference,
  type TrialInferenceStatus,
} from "@/api";

/**
 * Main site surface (Local + Cloud): The Graph is the land.
 * Chat chrome is open by default (Unlock hubs removed from the map).
 */
export function PreAuthChatCanvas() {
  const trialStarted = useRef(false);
  const [trial, setTrial] = useState<TrialInferenceStatus | null>(null);

  useEffect(() => {
    if (trialStarted.current) return;
    trialStarted.current = true;
    void ensureTrialInference()
      .then(setTrial)
      .catch(() => {
        setTrial(null);
      });
  }, []);

  const showTrialHint =
    trial != null &&
    !trial.ready &&
    (trial.status === "unconfigured" || trial.status === "failed");

  return (
    <div className="relative flex h-dvh w-full flex-col bg-background text-foreground">
      <main className="relative min-h-0 flex-1" aria-hidden />
      <ChatGraphCanvas />
      {showTrialHint && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center p-3">
          <p className="max-w-lg rounded-md border border-border/60 bg-background/90 px-3 py-2 text-center text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
            {trial.detail ??
              "Trial inference is not configured yet. You can still explore The Graph; connect a model after sign-in."}
          </p>
        </div>
      )}
      <IntelligencePanel />
      <InformationFloatingPanel />
      <Toaster richColors position="top-right" />
    </div>
  );
}
