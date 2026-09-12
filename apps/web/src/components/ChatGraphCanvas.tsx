import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ModeToggle } from "@/components/ModeToggle";
import { WindowAnchorGridOverlay } from "@/components/floating/WindowAnchorGridOverlay";
import { useIntelligence } from "@/lib/intelligence-context";
import { useTenant } from "@/lib/tenant-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  AnchorIcon,
  Grid3x3Icon,
  LayoutTemplateIcon,
  Maximize2Icon,
  MessageSquare,
  MessageSquareOff,
  PanelRightIcon,
  RotateCcwIcon,
  SaveIcon,
  TrophyIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { GraphScene3DHandle } from "@/components/graph/GraphScene3D";
import { GraphEtherComposer } from "@/components/graph/GraphEtherComposer";

function GraphToolIconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant={pressed ? "secondary" : "outline"}
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className="bg-background/80 shadow-sm backdrop-blur-sm"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [glOk] = useState(() => webglAvailable());
  const sceneRef = useRef<GraphScene3DHandle | null>(null);

  const lowPower =
    isMobile ||
    (typeof navigator !== "undefined" &&
      typeof navigator.hardwareConcurrency === "number" &&
      navigator.hardwareConcurrency > 0 &&
      navigator.hardwareConcurrency <= 12);
  // Ether log is a large DOM tree; keep it closed on low-power / mid PCs until asked.
  const [etherChatOpen, setEtherChatOpen] = useState(() => !lowPower);
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
      // Missions scoreboard is signed-in chrome; skip on guest / new-install land.
      authenticated ? fetchGraphMissions().catch(() => null) : Promise.resolve(null),
    ])
      .then(([proj, doc, missions]) => {
        setLayoutDoc(doc);
        if (proj && proj.nodes.length > 0) {
          setProjection(proj);
        } else {
          setProjection(null);
        }
        if (missions) setTotalPoints(missions.totalPoints);
        else if (!authenticated) setTotalPoints(null);
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
      {/* Right-edge tools rail: icon strip expands outward from the handle. */}
      <div className="pointer-events-auto absolute top-1/2 right-3 z-20 flex -translate-y-1/2 items-center gap-1.5">
        <div
          id="graph-tools-rail"
          role="toolbar"
          aria-label="Graph tools"
          aria-hidden={!toolsOpen}
          className={cn(
            "flex flex-col gap-1.5 origin-right transition-[opacity,transform] duration-200 ease-out",
            toolsOpen
              ? "translate-x-0 scale-100 opacity-100"
              : "pointer-events-none translate-x-2 scale-95 opacity-0"
          )}
        >
          <GraphToolIconButton
            label="Reset view"
            onClick={() => sceneRef.current?.reset()}
            disabled={!glOk}
          >
            <RotateCcwIcon />
          </GraphToolIconButton>
          <GraphToolIconButton
            label="Fit all"
            onClick={() => sceneRef.current?.fitAll()}
            disabled={!glOk}
          >
            <Maximize2Icon />
          </GraphToolIconButton>
          <GraphToolIconButton
            label="Toggle grid"
            pressed={anchorGridOpen}
            onClick={() => setAnchorGridOpen((v) => !v)}
          >
            <Grid3x3Icon />
          </GraphToolIconButton>
          <GraphToolIconButton
            label="Anchor windows"
            pressed={anchorPickMode}
            onClick={beginAnchorPick}
          >
            <AnchorIcon />
          </GraphToolIconButton>
          <GraphToolIconButton
            label="Reset windows"
            onClick={resetWindowAnchors}
          >
            <LayoutTemplateIcon />
          </GraphToolIconButton>
          {authenticated ? (
            <GraphToolIconButton label="Save layout" onClick={persistLayout}>
              <SaveIcon />
            </GraphToolIconButton>
          ) : null}
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant={toolsOpen ? "secondary" : "outline"}
                className="bg-background/80 shadow-sm backdrop-blur-sm"
                aria-label={toolsOpen ? "Close graph tools" : "Open graph tools"}
                aria-expanded={toolsOpen}
                aria-controls="graph-tools-rail"
                onClick={() => setToolsOpen((v) => !v)}
              />
            }
          >
            <PanelRightIcon />
          </TooltipTrigger>
          <TooltipContent side="left">
            {toolsOpen ? "Close tools" : "Graph tools"}
          </TooltipContent>
        </Tooltip>
      </div>
      {/* Ether log + composer; theme/chat sit on the message-box row when open.
          Keep GraphEtherComposer mounted so Hide chat does not wipe history. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-4">
        <div
          className={
            etherChatOpen
              ? "pointer-events-auto flex min-h-0 w-[min(420px,48vw)] flex-1 flex-col"
              : "hidden"
          }
          aria-hidden={!etherChatOpen}
        >
          <GraphEtherComposer
            composerTrailing={
              <>
                <ModeToggle size="icon-sm" variant="outline" />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="secondary"
                        aria-pressed={true}
                        aria-label="Hide chat"
                        onClick={toggleEtherChat}
                      />
                    }
                  >
                    <MessageSquareOff />
                  </TooltipTrigger>
                  <TooltipContent>Hide chat</TooltipContent>
                </Tooltip>
                {totalPoints != null ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          aria-label={`${totalPoints} points`}
                        />
                      }
                    >
                      <TrophyIcon />
                    </TooltipTrigger>
                    <TooltipContent>
                      {`${totalPoints} points. Open You on The Graph for your full scorecard`}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </>
            }
          />
        </div>
        {!etherChatOpen ? (
          <div className="pointer-events-auto mt-auto flex shrink-0 items-center gap-1.5">
            <ModeToggle size="icon-sm" variant="outline" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-pressed={false}
                    aria-label="Show chat"
                    onClick={toggleEtherChat}
                  />
                }
              >
                <MessageSquare />
              </TooltipTrigger>
              <TooltipContent>Show chat</TooltipContent>
            </Tooltip>
            {totalPoints != null ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label={`${totalPoints} points`}
                    />
                  }
                >
                  <TrophyIcon />
                </TooltipTrigger>
                <TooltipContent>
                  {`${totalPoints} points. Open You on The Graph for your full scorecard`}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* focusId retained for future chat-focus merge */}
      <span className="sr-only" data-focus-chat={focusId} />
    </div>
  );
}
