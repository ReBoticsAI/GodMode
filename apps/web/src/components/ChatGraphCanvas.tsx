import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchChatGraph,
  fetchGraphMissions,
  fetchGraphProjection,
  saveChatGraph,
  type ChatGraphDoc,
  type GraphCtaAction,
  type GraphProjection,
  type GraphProjectionNode,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ModeToggle";
import { WindowAnchorGridOverlay } from "@/components/floating/WindowAnchorGridOverlay";
import { useIntelligence } from "@/lib/intelligence-context";
import { useTenant } from "@/lib/tenant-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { Grid3x3Icon, AnchorIcon, LayoutTemplateIcon, MessageSquare, TrophyIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { GraphScene3DHandle } from "@/components/graph/GraphScene3D";
import { GraphEtherComposer } from "@/components/graph/GraphEtherComposer";

const GraphScene3D = lazy(() =>
  import("@/components/graph/GraphScene3D").then((m) => ({
    default: m.GraphScene3D,
  }))
);

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") || canvas.getContext("webgl")
    );
  } catch {
    return false;
  }
}

/** Ultimate canvas: GodMode architecture graph. Chat docks as a floating panel. */
export function ChatGraphCanvas({
  focusChatId,
}: {
  focusChatId?: string | null;
} = {}) {
  const {
    openPanel,
    panelOpen,
    setPanelOpen,
    setChatTarget,
    openInformationPanel,
    informationNode,
  } = useIntelligence();
  const { authenticated } = useTenant();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [projection, setProjection] = useState<GraphProjection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [layoutDoc, setLayoutDoc] = useState<ChatGraphDoc | null>(null);
  const [totalPoints, setTotalPoints] = useState<number | null>(null);
  const [anchorGridOpen, setAnchorGridOpen] = useState(false);
  const [anchorPickMode, setAnchorPickMode] = useState(false);
  const [etherChatOpen, setEtherChatOpen] = useState(true);
  const [glOk] = useState(() => webglAvailable());
  const sceneRef = useRef<GraphScene3DHandle | null>(null);

  const lowPower = isMobile;
  const focusId =
    focusChatId ??
    layoutDoc?.nodes[0]?.chatId ??
    `session-local`;

  const reload = useCallback(() => {
    void Promise.all([
      fetchGraphProjection({ focusType: "architecture" }).catch(() => null),
      authenticated
        ? fetchChatGraph().catch(() => ({ nodes: [], edges: [] }) as ChatGraphDoc)
        : Promise.resolve({ nodes: [], edges: [] } as ChatGraphDoc),
      fetchGraphMissions().catch(() => null),
    ])
      .then(([proj, doc, missions]) => {
        setLayoutDoc(doc);
        if (proj && proj.nodes.length > 0) {
          setProjection(proj);
        } else {
          setProjection(null);
        }
        if (missions) setTotalPoints(missions.totalPoints);
      })
      .finally(() => setLoaded(true));
  }, [authenticated]);

  useEffect(() => {
    reload();
    window.addEventListener("godmode:chat-graph-changed", reload);
    window.addEventListener("godmode:graph-missions-changed", reload);
    return () => {
      window.removeEventListener("godmode:chat-graph-changed", reload);
      window.removeEventListener("godmode:graph-missions-changed", reload);
    };
  }, [reload]);

  const openChatSurface = useCallback(
    (node?: GraphProjectionNode, agentId?: string) => {
      const fromWindows =
        node?.windows?.find((w) => w.kind === "chat" && w.agentId)?.agentId ??
        undefined;
      const aid =
        agentId ??
        fromWindows ??
        (node?.id === "hub:chat-you"
          ? "digital-you"
          : node?.id === "hub:chat-intelligence"
            ? "intelligence"
            : undefined) ??
        (node?.kind === "agent" && node.refId ? node.refId : undefined);
      if (aid) {
        setChatTarget({ kind: "agent", agentId: aid });
        openPanel({
          tab: "chat",
          agentId: aid,
          maximized: false,
        });
        return;
      }
      openPanel({ tab: "chat", maximized: false });
    },
    [openPanel, setChatTarget]
  );

  /** Apply WindowSpec recipes from the architecture catalog. */
  const applyNodeWindows = useCallback(
    (node: GraphProjectionNode) => {
      const specs =
        node.windows && node.windows.length > 0
          ? node.windows
          : node.kind === "chat"
            ? ([
                { kind: "chat" as const, placement: "left" as const },
                { kind: "information" as const, placement: "right" as const },
              ] as const)
            : ([{ kind: "information" as const, placement: "right" as const }] as const);

      let openedChat = false;
      let openedInfo = false;
      for (const w of specs) {
        if (w.kind === "chat") {
          const agentId =
            "agentId" in w && typeof w.agentId === "string"
              ? w.agentId
              : undefined;
          openChatSurface(node, agentId);
          openedChat = true;
        } else if (w.kind === "information" || w.kind === "canvas") {
          openInformationPanel(node);
          openedInfo = true;
        }
      }
      if (!openedInfo && !openedChat) {
        openInformationPanel(node);
      }
    },
    [openChatSurface, openInformationPanel]
  );

  const toggleEtherChat = useCallback(() => {
    setEtherChatOpen((v) => !v);
  }, []);

  const resetWindowAnchors = useCallback(() => {
    if (!panelOpen) openChatSurface();
    if (informationNode) openInformationPanel(informationNode);
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("godmode:reset-window-anchors"));
    });
  }, [
    panelOpen,
    openChatSurface,
    informationNode,
    openInformationPanel,
  ]);

  const beginAnchorPick = useCallback(() => {
    if (anchorPickMode) {
      setAnchorPickMode(false);
      window.dispatchEvent(
        new CustomEvent("godmode:anchor-pick-mode", {
          detail: { active: false },
        })
      );
      return;
    }
    setAnchorGridOpen(true);
    setAnchorPickMode(true);
    window.dispatchEvent(
      new CustomEvent("godmode:anchor-pick-mode", {
        detail: { active: true },
      })
    );
  }, [anchorPickMode]);

  useEffect(() => {
    const onPick = (ev: Event) => {
      setAnchorPickMode(
        Boolean((ev as CustomEvent<{ active?: boolean }>).detail?.active)
      );
    };
    window.addEventListener("godmode:anchor-pick-mode", onPick);
    return () => window.removeEventListener("godmode:anchor-pick-mode", onPick);
  }, []);

  const runCta = useCallback(
    (action: GraphCtaAction, node: GraphProjectionNode) => {
      switch (action.type) {
        case "open_chat":
          applyNodeWindows(node);
          return;
        case "open_panel":
          openPanel({
            tab: action.tab as
              | "chat"
              | "notifications"
              | "calendar"
              | "projects"
              | "knowledge"
              | "bank"
              | "vault"
              | "support",
            maximized: false,
          });
          applyNodeWindows(node);
          return;
        case "navigate":
          if (!authenticated && action.path.startsWith("/settings")) {
            navigate("/?auth=1");
            window.dispatchEvent(new CustomEvent("godmode:open-auth"));
            return;
          }
          navigate(action.path);
          openPanel({ maximized: false });
          openInformationPanel(node);
          return;
        case "open_auth":
          openInformationPanel(node);
          if (!authenticated) {
            navigate("/?auth=1");
            window.dispatchEvent(new CustomEvent("godmode:open-auth"));
          } else {
            navigate("/settings");
          }
          return;
        case "open_unlock": {
          // Unlock hubs removed from Graph; treat as no-op chrome.
          return;
        }
        case "none":
        default:
          openInformationPanel(node);
          return;
      }
    },
    [
      applyNodeWindows,
      authenticated,
      navigate,
      openInformationPanel,
      openPanel,
    ]
  );

  const onNodeSelect = useCallback(
    (node: GraphProjectionNode) => {
      // Chat bubbles and agent nodes with chat WindowSpecs open chat (+ info).
      const hasChatWindow = Boolean(
        node.windows?.some((w) => w.kind === "chat")
      );
      if (
        hasChatWindow ||
        node.kind === "chat" ||
        node.id.startsWith("hub:chat-")
      ) {
        applyNodeWindows(node);
        return;
      }
      openInformationPanel(node);
    },
    [applyNodeWindows, openInformationPanel]
  );

  const onNodeActivate = useCallback(
    (node: GraphProjectionNode) => {
      // You / Intelligence: Information only (chat is on their Chat bubbles).
      if (node.id === "hub:you" || node.id === "hub:intelligence") {
        openInformationPanel(node);
        return;
      }
      if (node.windows && node.windows.length > 0) {
        if (node.cta && node.cta.type !== "open_chat" && node.cta.type !== "none") {
          runCta(node.cta, node);
          return;
        }
        applyNodeWindows(node);
        return;
      }
      if (node.kind === "chat") {
        applyNodeWindows(node);
        return;
      }
      if (node.kind === "user") {
        openInformationPanel(node);
        return;
      }
      applyNodeWindows(node);
    },
    [applyNodeWindows, openInformationPanel, runCta]
  );

  const persistLayout = useCallback(() => {
    if (!authenticated || !layoutDoc) return;
    void saveChatGraph(layoutDoc).catch(() => undefined);
  }, [authenticated, layoutDoc]);

  const empty = loaded && (projection?.nodes.length ?? 0) === 0;
  const emptyHint = useMemo(
    () =>
      "The Graph maps GodMode architecture. Click to select; double-click to open Chat or Information.",
    []
  );

  return (
    <div className="absolute inset-0 z-0 bg-background">
      {!glOk ? (
        <div className="flex h-full items-center justify-center p-6">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            WebGL is required for The Graph. Enable hardware acceleration or try
            another browser.
          </p>
        </div>
      ) : projection ? (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading universe…
            </div>
          }
        >
          <GraphScene3D
            ref={sceneRef}
            projection={projection}
            lowPower={lowPower}
            onNodeActivate={onNodeActivate}
            onNodeSelect={onNodeSelect}
          />
        </Suspense>
      ) : loaded ? null : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading universe…
        </div>
      )}
      {empty ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            {emptyHint}
          </p>
        </div>
      ) : null}
      <WindowAnchorGridOverlay open={anchorGridOpen} anchorPickMode={anchorPickMode} />
      {/* Ether log stacks above chrome so the composer sits flush on the button row;
          keep GraphEtherComposer mounted so Hide chat does not wipe history. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-4">
        <div
          className={
            etherChatOpen
              ? "pointer-events-auto flex min-h-0 w-[min(420px,42vw)] flex-1 flex-col"
              : "hidden"
          }
          aria-hidden={!etherChatOpen}
        >
          <GraphEtherComposer />
        </div>
        <div className="pointer-events-auto mt-auto flex w-full shrink-0 flex-col gap-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {glOk ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => sceneRef.current?.reset()}
                >
                  Reset view
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => sceneRef.current?.fitAll()}
                >
                  Fit all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={anchorGridOpen ? "secondary" : "outline"}
                  aria-pressed={anchorGridOpen}
                  title="Show XY block grid and window corner blocks"
                  onClick={() => setAnchorGridOpen((v) => !v)}
                >
                  <Grid3x3Icon data-icon="inline-start" />
                  Grid
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={anchorPickMode ? "secondary" : "outline"}
                  aria-pressed={anchorPickMode}
                  title="Click a window to snap it; its pair mirrors across the focus node"
                  onClick={beginAnchorPick}
                >
                  <AnchorIcon data-icon="inline-start" />
                  Anchor
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="Snap Chat and Information back to default focus slots"
                  onClick={resetWindowAnchors}
                >
                  <LayoutTemplateIcon data-icon="inline-start" />
                  Reset windows
                </Button>
                <ModeToggle size="icon-sm" variant="outline" />
                <Button
                  type="button"
                  size="sm"
                  variant={etherChatOpen ? "secondary" : "outline"}
                  aria-pressed={etherChatOpen}
                  title={etherChatOpen ? "Hide graph chat" : "Show graph chat"}
                  onClick={toggleEtherChat}
                >
                  <MessageSquare data-icon="inline-start" />
                  {etherChatOpen ? "Hide chat" : "Show chat"}
                </Button>
              </>
            ) : (
              <>
                <ModeToggle size="icon-sm" variant="outline" />
                <Button
                  type="button"
                  size="sm"
                  variant={etherChatOpen ? "secondary" : "outline"}
                  aria-pressed={etherChatOpen}
                  title={etherChatOpen ? "Hide graph chat" : "Show graph chat"}
                  onClick={toggleEtherChat}
                >
                  <MessageSquare data-icon="inline-start" />
                  {etherChatOpen ? "Hide chat" : "Show chat"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={anchorGridOpen ? "secondary" : "outline"}
                  aria-pressed={anchorGridOpen}
                  title="Show XY block grid and window corner blocks"
                  onClick={() => setAnchorGridOpen((v) => !v)}
                >
                  <Grid3x3Icon data-icon="inline-start" />
                  Grid
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={anchorPickMode ? "secondary" : "outline"}
                  aria-pressed={anchorPickMode}
                  title="Click a window to snap it; its pair mirrors across the focus node"
                  onClick={beginAnchorPick}
                >
                  <AnchorIcon data-icon="inline-start" />
                  Anchor
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="Snap Chat and Information back to default focus slots"
                  onClick={resetWindowAnchors}
                >
                  <LayoutTemplateIcon data-icon="inline-start" />
                  Reset windows
                </Button>
              </>
            )}
            {totalPoints != null ? (
              <Badge
                variant="secondary"
                className="gap-1 px-2 py-1 text-[11px]"
                title="Open You on The Graph for your full scorecard"
              >
                <TrophyIcon className="size-3" />
                {totalPoints} pts
              </Badge>
            ) : null}
            {authenticated ? (
              <Button type="button" size="sm" variant="outline" onClick={persistLayout}>
                Save layout
              </Button>
            ) : null}
          </div>
          {glOk ? (
            <p className="rounded-md border border-border/40 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
              Drag pan · Scroll zoom · Right-drag orbit · WASD · Click select ·
              Double-click open · Grid shows XY blocks · Anchor snaps one window
              and mirrors its pair across the focus node · Reset windows restores
              default slots · Show/Hide chat toggles the left ether log
            </p>
          ) : null}
        </div>
      </div>
      {/* focusId retained for future chat-focus merge */}
      <span className="sr-only" data-focus-chat={focusId} />
    </div>
  );
}
