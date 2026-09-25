import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchAiAgents } from "@/api";
import {
  getActiveFloatingWindowId,
  subscribeFloatingWindowRegistry,
} from "@/lib/floating-window-registry";
import { useIntelligence } from "@/lib/intelligence-context";
import {
  fallbackAgentLabel,
  focusChromeForChatWindow,
  focusChromeForInbox,
  focusChromeForLeftTab,
  isAgentScopedLeftTab,
  type FocusChrome,
} from "@/lib/focus-chrome";
import { focusOwnerLabel } from "@/lib/graph-focus-owner";

export type FocusChip = FocusChrome & {
  /** Composer is sending to a focused chat window. */
  mode: "replying" | "focused";
};

/**
 * Focus chip for the ether composer: icon + "Replying to X" or "Focused on X".
 * Follows the last-interacted floating window, not a sticky chat focus id.
 */
export function useGraphFocusChip(): FocusChip | null {
  const activeWindowId = useSyncExternalStore(
    subscribeFloatingWindowRegistry,
    getActiveFloatingWindowId,
    () => null
  );
  const {
    informationPanelOpen,
    informationPanelMinimized,
    panelOpen,
    panelMinimized,
    activeLeftTab,
    chatInboxOpen,
    openChatWindows,
    focusedChatWindowId,
    informationNode,
    activeAgentId,
    focusOwner,
  } = useIntelligence();

  const [agentNames, setAgentNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void fetchAiAgents()
      .then((res) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const a of res.agents ?? []) {
          if (a.id && a.name) next[a.id] = a.name;
        }
        setAgentNames(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  let scopeAgentLabel: string | null = null;
  if (isAgentScopedLeftTab(activeLeftTab)) {
    const fromOwner = focusOwnerLabel(focusOwner);
    if (fromOwner) {
      scopeAgentLabel = fromOwner;
    } else if (activeAgentId) {
      const fromCatalog = agentNames[activeAgentId];
      const fromWindow = openChatWindows.find(
        (w) => w.kind === "agent" && w.agentId === activeAgentId && w.title
      )?.title;
      scopeAgentLabel =
        fromCatalog || fromWindow || fallbackAgentLabel(activeAgentId);
    }
    if (focusOwner.kind === "agent" && agentNames[focusOwner.agentId]) {
      scopeAgentLabel = agentNames[focusOwner.agentId];
    }
  }

  const infoChrome = () =>
    focusChromeForLeftTab(activeLeftTab, {
      infoNodeLabel: informationNode?.label ?? null,
      scopeAgentLabel,
    });

  // 1) Last-interacted floating window wins (graph node → Information, etc.).
  if (activeWindowId === "information") {
    if (informationPanelOpen && !informationPanelMinimized) {
      return { ...infoChrome(), mode: "focused" };
    }
  }

  if (activeWindowId === "chat-inbox" && chatInboxOpen) {
    return { ...focusChromeForInbox(), mode: "focused" };
  }

  // IntelligencePanel registers as floating window id "chat".
  if (activeWindowId === "chat" && panelOpen && !panelMinimized) {
    const label =
      agentNames[activeAgentId] || fallbackAgentLabel(activeAgentId);
    return {
      ...focusChromeForChatWindow({
        id: "chat",
        kind: "agent",
        agentId: activeAgentId,
        title: label,
        minimized: false,
      }),
      mode: "replying",
    };
  }

  if (activeWindowId) {
    const activeChat = openChatWindows.find(
      (w) => w.id === activeWindowId && !w.minimized
    );
    if (activeChat) {
      return {
        ...focusChromeForChatWindow(activeChat),
        mode: "replying",
      };
    }
  }

  // 2) Fallbacks when registry has no active id yet.
  if (informationPanelOpen && !informationPanelMinimized) {
    return { ...infoChrome(), mode: "focused" };
  }

  if (panelOpen && !panelMinimized) {
    const label =
      agentNames[activeAgentId] || fallbackAgentLabel(activeAgentId);
    return {
      ...focusChromeForChatWindow({
        id: "chat",
        kind: "agent",
        agentId: activeAgentId,
        title: label,
        minimized: false,
      }),
      mode: "replying",
    };
  }

  const focusedWin = focusedChatWindowId
    ? openChatWindows.find((w) => w.id === focusedChatWindowId && !w.minimized)
    : null;
  if (focusedWin) {
    return { ...focusChromeForChatWindow(focusedWin), mode: "replying" };
  }

  if (chatInboxOpen) {
    return { ...focusChromeForInbox(), mode: "focused" };
  }

  return null;
}
