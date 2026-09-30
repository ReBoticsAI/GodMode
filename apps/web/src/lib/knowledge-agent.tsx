import { createContext, useContext, type ReactNode } from "react";
import { useIntelligence } from "@/lib/intelligence-context";

const KnowledgeAgentContext = createContext<string | null>(null);

/** Pin knowledge reads to one agent. Omit to follow the open chat agent. */
export function KnowledgeAgentScope({
  agentId,
  children,
}: {
  agentId?: string | null;
  children: ReactNode;
}) {
  return (
    <KnowledgeAgentContext.Provider value={agentId ?? null}>
      {children}
    </KnowledgeAgentContext.Provider>
  );
}

export function useKnowledgeAgentId(): string {
  const override = useContext(KnowledgeAgentContext);
  const { activeAgentId } = useIntelligence();
  return override || activeAgentId;
}
