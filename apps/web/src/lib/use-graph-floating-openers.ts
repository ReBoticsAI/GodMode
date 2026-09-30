/**
 * Registers Graph floating-window openers (godmode:open-* + node select).
 * Used by ChatGraphCanvas so chrome surfaces stay over the Graph.
 * Canonical entry: openGraphSurface (left rail, deep links, menus, CTAs).
 */

import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { GraphProjectionNode } from "@/api";
import type { FocusOwner } from "@/lib/graph-focus-owner";
import { resolveFloatingNodeId } from "@/lib/graph-focus-owner";
import type { LeftRailTab } from "@/lib/intelligence-context";
import {
  GRAPH_FLOATING_SURFACES,
  resolveFloatingSurface,
  type GraphFloatingSurface,
} from "@/lib/graph-floating-surfaces";
import { HOME_PATH } from "@/lib/navigation";

export type OpenGraphSurfaceInput = {
  tab?: string;
  path?: string;
  event?: string;
  focusOwner?: FocusOwner;
  /** When false, skip sign-in gate (left-rail on Graph land). Default true. */
  requireAuth?: boolean;
};

type OpenOpts = {
  authenticated: boolean;
  projectionNodes: GraphProjectionNode[] | undefined;
  openInformationPanel: (node: GraphProjectionNode) => void;
  openLeftRailTab: (tab: LeftRailTab) => void;
  sceneSelectNode: (id: string) => void;
  focusOwner: FocusOwner;
};

function openSurface(
  surface: GraphFloatingSurface,
  opts: OpenOpts,
  navigate: ReturnType<typeof useNavigate>,
  focusOwnerOverride?: FocusOwner,
  requireAuth = true
) {
  if (requireAuth && !opts.authenticated) {
    toast.message(`Sign in to open ${surface.authLabel}`);
    navigate("/?auth=1");
    return;
  }
  const owner = focusOwnerOverride ?? opts.focusOwner;
  const nodeId = resolveFloatingNodeId(surface.nodeId, owner);
  if (nodeId) {
    const node = opts.projectionNodes?.find((n) => n.id === nodeId) ?? null;
    if (node) {
      opts.sceneSelectNode(node.id);
      opts.openInformationPanel(node);
    }
  }
  opts.openLeftRailTab(surface.tab as LeftRailTab);
  if (typeof window !== "undefined") {
    const path = window.location.pathname;
    const onHome = path === HOME_PATH || path === "/";
    if (!onHome) {
      navigate(
        { pathname: HOME_PATH },
        { replace: path === surface.path }
      );
    }
  }
}

export function useGraphFloatingOpeners(opts: OpenOpts) {
  const navigate = useNavigate();
  const {
    authenticated,
    projectionNodes,
    openInformationPanel,
    openLeftRailTab,
    sceneSelectNode,
    focusOwner,
  } = opts;

  const openGraphSurface = useCallback(
    (input: OpenGraphSurfaceInput) => {
      const surface = resolveFloatingSurface(input);
      if (!surface) return false;
      // Platform Vault / Admin keep richer detail handlers in ChatGraphCanvas.
      if (surface.tab === "platform-vault" || surface.tab === "admin") {
        return false;
      }
      openSurface(
        surface,
        {
          authenticated,
          projectionNodes,
          openInformationPanel,
          openLeftRailTab,
          sceneSelectNode,
          focusOwner,
        },
        navigate,
        input.focusOwner,
        input.requireAuth !== false
      );
      return true;
    },
    [
      authenticated,
      focusOwner,
      navigate,
      openInformationPanel,
      openLeftRailTab,
      projectionNodes,
      sceneSelectNode,
    ]
  );

  const openByTab = useCallback(
    (tab: string) => openGraphSurface({ tab }),
    [openGraphSurface]
  );

  useEffect(() => {
    const handlers: Array<{ event: string; fn: EventListener }> = [];
    const current: OpenOpts = {
      authenticated,
      projectionNodes,
      openInformationPanel,
      openLeftRailTab,
      sceneSelectNode,
      focusOwner,
    };
    for (const surface of GRAPH_FLOATING_SURFACES) {
      if (surface.tab === "platform-vault" || surface.tab === "admin") {
        continue;
      }
      const fn: EventListener = () => {
        openSurface(surface, current, navigate);
      };
      window.addEventListener(surface.event, fn);
      handlers.push({ event: surface.event, fn });
    }
    return () => {
      for (const h of handlers) {
        window.removeEventListener(h.event, h.fn);
      }
    };
  }, [
    authenticated,
    focusOwner,
    navigate,
    openInformationPanel,
    openLeftRailTab,
    projectionNodes,
    sceneSelectNode,
  ]);

  return { openByTab, openGraphSurface };
}
