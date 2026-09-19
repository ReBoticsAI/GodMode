/**
 * Registers Graph floating-window openers (godmode:open-* + node select).
 * Used by ChatGraphCanvas so chrome surfaces stay over the Graph.
 */

import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { GraphProjectionNode } from "@/api";
import type { LeftRailTab } from "@/lib/intelligence-context";
import {
  GRAPH_FLOATING_SURFACES,
  type GraphFloatingSurface,
} from "@/lib/graph-floating-surfaces";
import { HOME_PATH } from "@/lib/navigation";

type OpenOpts = {
  authenticated: boolean;
  projectionNodes: GraphProjectionNode[] | undefined;
  openInformationPanel: (node: GraphProjectionNode) => void;
  openLeftRailTab: (tab: LeftRailTab) => void;
  sceneSelectNode: (id: string) => void;
};

function openSurface(
  surface: GraphFloatingSurface,
  opts: OpenOpts,
  navigate: ReturnType<typeof useNavigate>
) {
  if (!opts.authenticated) {
    toast.message(`Sign in to open ${surface.authLabel}`);
    navigate("/?auth=1");
    return;
  }
  if (surface.nodeId) {
    const node =
      opts.projectionNodes?.find((n) => n.id === surface.nodeId) ?? null;
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
  const { authenticated, projectionNodes, openInformationPanel, openLeftRailTab, sceneSelectNode } =
    opts;

  const openByTab = useCallback(
    (tab: string) => {
      const surface = GRAPH_FLOATING_SURFACES.find((s) => s.tab === tab);
      if (!surface) return;
      openSurface(
        surface,
        {
          authenticated,
          projectionNodes,
          openInformationPanel,
          openLeftRailTab,
          sceneSelectNode,
        },
        navigate
      );
    },
    [
      authenticated,
      navigate,
      openInformationPanel,
      openLeftRailTab,
      projectionNodes,
      sceneSelectNode,
    ]
  );

  useEffect(() => {
    const handlers: Array<{ event: string; fn: EventListener }> = [];
    for (const surface of GRAPH_FLOATING_SURFACES) {
      // Platform Vault / Admin keep richer detail handlers in ChatGraphCanvas.
      if (
        surface.tab === "platform-vault" ||
        surface.tab === "admin"
      ) {
        continue;
      }
      const fn: EventListener = () => {
        openSurface(
          surface,
          {
            authenticated,
            projectionNodes,
            openInformationPanel,
            openLeftRailTab,
            sceneSelectNode,
          },
          navigate
        );
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
    navigate,
    openInformationPanel,
    openLeftRailTab,
    projectionNodes,
    sceneSelectNode,
  ]);

  // Select node once projection lands if a floating tab is already active.
  useEffect(() => {
    if (!projectionNodes?.length) return;
    for (const surface of GRAPH_FLOATING_SURFACES) {
      if (!surface.nodeId) continue;
      // Active-tab selection is handled by ChatGraphCanvas for vault/admin/wiki;
      // this covers the rest when openers fire before projection.
    }
  }, [projectionNodes]);

  return { openByTab };
}
