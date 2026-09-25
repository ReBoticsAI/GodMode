import { useEffect, useRef } from "react";
import { InformationFloatingPanel } from "@/components/intelligence/InformationFloatingPanel";
import { CloudGuideWindow } from "@/components/graph/CloudGuideWindow";
import { IntelligencePanel } from "@/components/intelligence/IntelligencePanel";
import { MinimizedWindowsDock } from "@/components/floating/MinimizedWindowsDock";
import { ChatGraphCanvas } from "@/components/ChatGraphCanvas";
import { GraphEscMenu } from "@/components/graph/GraphEscMenu";
import { Toaster } from "@/components/ui/sonner";
import { ensureTrialInference } from "@/api";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  ACTIVE_AGENT_KEY,
  LEGACY_ACTIVE_AGENT_KEY,
  writeMigratedKey,
} from "@/lib/storage-keys";

/**
 * Main site surface (Local + Cloud): The Graph is the land.
 * Chat chrome is open by default (Unlock hubs removed from the map).
 */
export function PreAuthChatCanvas() {
  const trialStarted = useRef(false);
  const { setChatTarget } = useIntelligence();

  useEffect(() => {
    if (trialStarted.current) return;
    trialStarted.current = true;
    writeMigratedKey(ACTIVE_AGENT_KEY, LEGACY_ACTIVE_AGENT_KEY, "intelligence");
    setChatTarget({ kind: "agent", agentId: "intelligence" });
    void ensureTrialInference().catch(() => undefined);
  }, [setChatTarget]);

  return (
    <div className="relative flex h-dvh w-full flex-col bg-background text-foreground">
      <main className="relative min-h-0 flex-1" aria-hidden />
      <ChatGraphCanvas />
      <IntelligencePanel />
      <InformationFloatingPanel />
      <CloudGuideWindow />
      <MinimizedWindowsDock />
      <GraphEscMenu />
      <Toaster richColors position="top-right" />
    </div>
  );
}
