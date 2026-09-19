import { useEffect, useRef } from "react";
import { InformationFloatingPanel } from "@/components/intelligence/InformationFloatingPanel";
import { MinimizedWindowsDock } from "@/components/floating/MinimizedWindowsDock";
import { ChatGraphCanvas } from "@/components/ChatGraphCanvas";
import { GraphEscMenu } from "@/components/graph/GraphEscMenu";
import { Toaster } from "@/components/ui/sonner";
import { ensureTrialInference } from "@/api";

/**
 * Main site surface (Local + Cloud): The Graph is the land.
 * Chat chrome is open by default (Unlock hubs removed from the map).
 */
export function PreAuthChatCanvas() {
  const trialStarted = useRef(false);

  useEffect(() => {
    if (trialStarted.current) return;
    trialStarted.current = true;
    void ensureTrialInference().catch(() => undefined);
  }, []);

  return (
    <div className="relative flex h-dvh w-full flex-col bg-background text-foreground">
      <main className="relative min-h-0 flex-1" aria-hidden />
      <ChatGraphCanvas />
      <InformationFloatingPanel />
      <MinimizedWindowsDock />
      <GraphEscMenu />
      <Toaster richColors position="top-right" />
    </div>
  );
}
