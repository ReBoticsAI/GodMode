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
  fetchAiQueue,
  fetchAiStatus,
  fetchBridgeHealth,
  fetchChatGraph,
  fetchGraphMissions,
  fetchGraphProjection,
  saveChatGraph,
  syncGraphMissions,
  fetchChatUnlockStatus,
  fetchAiRules,
  type ChatGraphDoc,
  type GraphProjection,
  type GraphProjectionNode,
} from "@/api";
import { fetchObjectTypes } from "@/lib/object-types-api";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ModeToggle } from "@/components/ModeToggle";
import { WindowAnchorGridOverlay } from "@/components/floating/WindowAnchorGridOverlay";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import {
  labelForConnectKind,
  type GraphConnectKind,
} from "@/components/graph/GraphConnectKindMenu";
import {
  labelForCreateKind,
  type GraphCreateKind,
} from "@/components/graph/GraphCreateKindMenu";
import {
  labelForEditKind,
  type GraphEditKind,
} from "@/components/graph/GraphEditKindMenu";
import {
  GRAPH_ACTION_CONNECT_ITEMS,
  GRAPH_ACTION_EDIT_ITEMS,
  graphActionItemsFor,
  type GraphActionModeId,
} from "@/components/graph/graph-action-menus";
import {
  labelForExecuteKind,
  type GraphExecuteKind,
} from "@/components/graph/GraphExecuteKindMenu";
import {
  labelForGovernKind,
  type GraphGovernKind,
} from "@/components/graph/GraphGovernKindMenu";
import {
  labelForMonitorKind,
  type GraphMonitorKind,
} from "@/components/graph/GraphMonitorKindMenu";
import {
  labelForOrganizeKind,
  type GraphOrganizeKind,
} from "@/components/graph/GraphOrganizeKindMenu";
import {
  labelForValidateKind,
  type GraphValidateKind,
} from "@/components/graph/GraphValidateKindMenu";
import {
  useIntelligence,
  type AgentsSection,
  type LeftRailTab,
} from "@/lib/intelligence-context";
import { useTenant } from "@/lib/tenant-context";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ADMIN_NODE_ID,
  ADMIN_PATH,
  HOME_PATH,
  PLATFORM_VAULT_NODE_ID,
  PLATFORM_VAULT_PATH,
} from "@/lib/navigation";
import {
  floatingSurfaceForTab,
  GRAPH_FLOATING_SURFACES,
} from "@/lib/graph-floating-surfaces";
import { useGraphFloatingOpeners } from "@/lib/use-graph-floating-openers";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AnchorIcon,
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  Grid3x3Icon,
  LayoutTemplateIcon,
  LifeBuoyIcon,
  Maximize2Icon,
  MessageSquare,
  MessageSquareOff,
  RotateCcwIcon,
  SaveIcon,
  TrophyIcon,
  WorkflowIcon,
} from "lucide-react";
import type { GraphScene3DHandle } from "@/components/graph/GraphScene3D";
import { GraphEtherComposer } from "@/components/graph/GraphEtherComposer";
import { GraphRareFindsTicker } from "@/components/graph/GraphRareFindsTicker";
import {
  buildSmartSuggestions,
  GraphSmartSuggest,
  type SmartSuggestItem,
} from "@/components/graph/GraphSmartSuggest";
import { GraphSystemNoticeBar } from "@/components/graph/GraphSystemNoticeBar";
import { GraphTopTenBoardDialog } from "@/components/graph/GraphTopTenBoardDialog";
import { ChatInboxWindow } from "@/components/chat/ChatInboxWindow";
import { ChatThreadWindowsHost } from "@/components/chat/ChatThreadWindow";
import { unreadCountsByKind } from "@/lib/chat-windows";
import { Badge } from "@/components/ui/badge";

const GRAPH_ACTION_MODES = [
  { id: "create", label: "Create" },
  { id: "edit", label: "Edit" },
  { id: "organize", label: "Organize" },
  { id: "connect", label: "Connect" },
  { id: "monitor", label: "Monitor" },
  { id: "execute", label: "Execute" },
  { id: "validate", label: "Validate" },
  { id: "govern", label: "Govern" },
] as const;

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

function GraphLeftTabIconButton({
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
      <TooltipContent side="right">{label}</TooltipContent>
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
  topNotice,
}: {
  focusChatId?: string | null;
  /** Optional banner above Graph search/actions (e.g. trial inference hint). */
  topNotice?: ReactNode;
} = {}) {
  const {
    setChatTarget,
    openInformationPanel,
    closeInformationPanel,
    openLeftRailTab,
    openPanel,
    setAgentsSection,
    informationNode,
    informationPanelOpen,
    informationPanelMinimized,
    activeLeftTab,
    setActiveLeftTab,
    startNewChat,
    setChatMode,
    chatInboxOpen,
    setChatInboxOpen,
    dmConversations,
    dmUnreadCount,
    activeAgentId,
    openOrFocusChatWindow,
    closeAllChatWindows,
    openChatWindows,
  } = useIntelligence();
  const { authenticated } = useTenant();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const [projection, setProjection] = useState<GraphProjection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [layoutDoc, setLayoutDoc] = useState<ChatGraphDoc | null>(null);
  const [totalPoints, setTotalPoints] = useState<number | null>(null);
  const [anchorGridOpen, setAnchorGridOpen] = useState(false);
  const [anchorPickMode, setAnchorPickMode] = useState(false);
  const [graphFilter, setGraphFilter] = useState("");
  const [topTenOpen, setTopTenOpen] = useState(false);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [glOk] = useState(() => webglAvailable());
  const sceneRef = useRef<GraphScene3DHandle | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const bottomChromeRef = useRef<HTMLDivElement | null>(null);
  const [bottomChromeWidth, setBottomChromeWidth] = useState<number | null>(
    null
  );
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [sendRequestId, setSendRequestId] = useState(0);

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

  // Keep in-progress (hard-hat) emblems fresh while a turn / job is active.
  useEffect(() => {
    if (!authenticated) return;
    const refreshWorking = () => {
      void fetchGraphProjection({ focusType: "architecture" })
        .then((proj) => {
          if (proj && proj.nodes.length > 0) setProjection(proj);
        })
        .catch(() => {
          /* optional */
        });
    };
    const onChatSent = () => {
      window.setTimeout(refreshWorking, 500);
    };
    window.addEventListener("godmode:user-chat-sent", onChatSent);
    const interval = window.setInterval(refreshWorking, 12_000);
    return () => {
      window.removeEventListener("godmode:user-chat-sent", onChatSent);
      window.clearInterval(interval);
    };
  }, [authenticated]);

  const selectCreateKind = useCallback(
    (kind: GraphCreateKind) => {
      if (kind === "chat") {
        if (!authenticated) {
          toast.message("Sign in to create a chat");
          return;
        }
        startNewChat();
        return;
      }

      if (kind === "workspace") {
        if (!authenticated) {
          toast.message("Sign in to create a workspace");
          return;
        }
        setWorkspaceCreateOpen(true);
        return;
      }

      toast.message(
        `Create ${labelForCreateKind(kind)} is not available from the Graph yet`
      );
    },
    [authenticated, startNewChat]
  );

  const openAgentsSection = useCallback(
    (section: AgentsSection) => {
      if (!authenticated) {
        toast.message("Sign in to open Agents");
        return;
      }
      setAgentsSection(section);
      window.dispatchEvent(
        new CustomEvent("godmode:open-agents", { detail: {} })
      );
    },
    [authenticated, setAgentsSection]
  );

  const selectExecuteKind = useCallback(
    (kind: GraphExecuteKind) => {
      const requireAuth = (message: string) => {
        if (authenticated) return true;
        toast.message(message);
        return false;
      };

      switch (kind) {
        case "run-chat-agent":
          setChatMode("agent");
          setEtherChatOpen(true);
          toast.message("Chat set to Agent mode");
          return;
        case "run-chat-plan":
          setChatMode("plan");
          setEtherChatOpen(true);
          toast.message("Chat set to Plan mode");
          return;
        case "slash-command":
          setEtherChatOpen(true);
          toast.message("Type a /command in chat to run it");
          return;
        case "run-workflow":
        case "run-schedule-now":
        case "trigger-hook":
        case "run-automation":
          openAgentsSection("workflows");
          return;
        case "run-pipeline":
          openAgentsSection("pipeline");
          return;
        case "run-agent":
          openAgentsSection("organization");
          return;
        case "autonomous-task-runner":
          if (!requireAuth("Sign in to run tasks")) return;
          window.dispatchEvent(new CustomEvent("godmode:open-tasks"));
          return;
        case "coding-terminal":
          if (!requireAuth("Sign in to open Coding")) return;
          window.dispatchEvent(new CustomEvent("godmode:open-coding"));
          return;
        case "release-prepare":
        case "release-publish":
          if (!requireAuth("Sign in to open Releases")) return;
          window.dispatchEvent(new CustomEvent("godmode:open-releases"));
          return;
        case "scaffold-plugin":
          window.dispatchEvent(new CustomEvent("godmode:open-marketplace"));
          return;
        case "install-pack":
          window.dispatchEvent(new CustomEvent("godmode:open-marketplace"));
          return;
        case "invoke-tool":
          openPanel({ tab: "knowledge", knowledgeSubTab: "tools" });
          return;
        case "claim-mission":
          if (!requireAuth("Sign in to run missions")) return;
          toast.message(
            "Open a Graph node Information panel to claim or run missions"
          );
          return;
        case "sync-missions":
          if (!requireAuth("Sign in to run a sync")) return;
          void syncGraphMissions()
            .then((result) => {
              window.dispatchEvent(
                new CustomEvent("godmode:graph-missions-changed")
              );
              const awarded = result.awarded?.length ?? 0;
              toast.message(
                awarded > 0
                  ? `Sync complete: ${awarded} mission(s) awarded`
                  : "Missions synced"
              );
              reload();
            })
            .catch(() => {
              toast.message("Could not sync missions");
            });
          return;
        case "support-promote-task":
          window.dispatchEvent(new CustomEvent("godmode:open-support"));
          return;
        case "run-job":
          toast.message(
            `Execute ${labelForExecuteKind(kind)} is not available from the Graph yet`
          );
          return;
        default: {
          const _exhaustive: never = kind;
          void _exhaustive;
          toast.message(
            `Execute ${labelForExecuteKind(kind)} is not available from the Graph yet`
          );
        }
      }
    },
    [
      authenticated,
      navigate,
      openAgentsSection,
      openPanel,
      reload,
      setChatMode,
    ]
  );

  const openInfoNode = useCallback(
    (nodeId: string) => {
      const node =
        projection?.nodes.find((n) => n.id === nodeId) ??
        projection?.nodes.find((n) => n.id.startsWith(nodeId));
      if (node) {
        sceneRef.current?.selectNode(node.id);
        openInformationPanel(node);
        return true;
      }
      return false;
    },
    [projection?.nodes, openInformationPanel]
  );

  /** Highlight Platform Vault on the Graph and open it in the floating window. */
  const openPlatformVault = useCallback(
    (opts?: { vault?: string | null; sub?: string | null }) => {
      if (!authenticated) {
        toast.message("Sign in to open Platform Vault");
        navigate("/?auth=1");
        return;
      }
      const vault = opts?.vault;
      const sub = opts?.sub;
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (vault) p.set("vault", vault);
          else if (!p.get("vault")) p.set("vault", "inference");
          if (sub) p.set("sub", sub);
          else if (p.get("vault") === "inference" && !p.get("sub")) {
            p.set("sub", "subscriptions");
          }
          return p;
        },
        { replace: true }
      );
      const node =
        projection?.nodes.find((n) => n.id === PLATFORM_VAULT_NODE_ID) ?? null;
      if (node) {
        sceneRef.current?.selectNode(node.id);
        openInformationPanel(node);
      }
      openLeftRailTab("platform-vault");
      if (typeof window !== "undefined") {
        const path = window.location.pathname;
        const onHome = path === HOME_PATH || path === "/";
        if (!onHome) {
          const next = new URLSearchParams(window.location.search);
          if (vault) next.set("vault", vault);
          else if (!next.get("vault")) next.set("vault", "inference");
          if (sub) next.set("sub", sub);
          else if (next.get("vault") === "inference" && !next.get("sub")) {
            next.set("sub", "subscriptions");
          }
          navigate(
            {
              pathname: HOME_PATH,
              search: next.toString() ? `?${next}` : "",
            },
            { replace: path === PLATFORM_VAULT_PATH }
          );
        }
      }
    },
    [
      authenticated,
      navigate,
      openInformationPanel,
      openLeftRailTab,
      projection?.nodes,
      setSearchParams,
    ]
  );

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{ vault?: string | null; sub?: string | null }>
      ).detail;
      openPlatformVault({
        vault: detail?.vault ?? searchParams.get("vault"),
        sub: detail?.sub ?? searchParams.get("sub"),
      });
    };
    window.addEventListener("godmode:open-platform-vault", onOpen);
    return () =>
      window.removeEventListener("godmode:open-platform-vault", onOpen);
  }, [openPlatformVault, searchParams]);

  // If Platform Vault opened before projection landed, select the node once it exists.
  useEffect(() => {
    if (activeLeftTab !== "platform-vault") return;
    if (!projection?.nodes.some((n) => n.id === PLATFORM_VAULT_NODE_ID)) return;
    sceneRef.current?.selectNode(PLATFORM_VAULT_NODE_ID);
  }, [activeLeftTab, projection?.nodes]);

  /** Highlight Admin on the Graph and open it in the floating window. */
  const openAdmin = useCallback(
    (opts?: { tab?: string | null }) => {
      if (!authenticated) {
        toast.message("Sign in to open Admin");
        navigate("/?auth=1");
        return;
      }
      const tab = opts?.tab;
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (tab) p.set("tab", tab);
          return p;
        },
        { replace: true }
      );
      const node =
        projection?.nodes.find((n) => n.id === ADMIN_NODE_ID) ?? null;
      if (node) {
        sceneRef.current?.selectNode(node.id);
        openInformationPanel(node);
      }
      openLeftRailTab("admin");
      if (typeof window !== "undefined") {
        const path = window.location.pathname;
        const onHome = path === HOME_PATH || path === "/";
        if (!onHome) {
          const next = new URLSearchParams(window.location.search);
          if (tab) next.set("tab", tab);
          navigate(
            {
              pathname: HOME_PATH,
              search: next.toString() ? `?${next}` : "",
            },
            { replace: path === ADMIN_PATH }
          );
        }
      }
    },
    [
      authenticated,
      navigate,
      openInformationPanel,
      openLeftRailTab,
      projection?.nodes,
      setSearchParams,
    ]
  );

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: string | null }>).detail;
      openAdmin({
        tab: detail?.tab ?? searchParams.get("tab"),
      });
    };
    window.addEventListener("godmode:open-admin", onOpen);
    return () => window.removeEventListener("godmode:open-admin", onOpen);
  }, [openAdmin, searchParams]);

  // If Admin opened before projection landed, select the node once it exists.
  useEffect(() => {
    if (activeLeftTab !== "admin") return;
    if (!projection?.nodes.some((n) => n.id === ADMIN_NODE_ID)) return;
    sceneRef.current?.selectNode(ADMIN_NODE_ID);
  }, [activeLeftTab, projection?.nodes]);

  const { openByTab } = useGraphFloatingOpeners({
    authenticated,
    projectionNodes: projection?.nodes,
    openInformationPanel,
    openLeftRailTab,
    sceneSelectNode: (id) => sceneRef.current?.selectNode(id),
  });

  // Select catalog node once projection lands for any active floating tab.
  useEffect(() => {
    const surface = GRAPH_FLOATING_SURFACES.find((s) => s.tab === activeLeftTab);
    if (!surface?.nodeId) return;
    if (!projection?.nodes.some((n) => n.id === surface.nodeId)) return;
    sceneRef.current?.selectNode(surface.nodeId);
  }, [activeLeftTab, projection?.nodes]);

  useEffect(() => {
    const onResetGraphView = () => {
      sceneRef.current?.reset();
    };
    window.addEventListener("godmode:reset-graph-view", onResetGraphView);
    return () => {
      window.removeEventListener("godmode:reset-graph-view", onResetGraphView);
    };
  }, []);

  const handleLeftTabClick = useCallback(
    (tab: LeftRailTab) => {
      if (
        informationPanelOpen &&
        !informationPanelMinimized &&
        activeLeftTab === tab
      ) {
        closeInformationPanel();
        return;
      }
      setActiveLeftTab(tab);
      if (tab === "info") {
        if (informationNode) {
          openInformationPanel(informationNode);
        } else {
          const fallback =
            projection?.nodes.find((n) => n.id === "hub:you") ??
            projection?.nodes[0];
          if (fallback) {
            openInformationPanel(fallback);
          } else {
            openLeftRailTab("info");
          }
        }
      } else {
        openLeftRailTab(tab);
      }
    },
    [
      informationPanelOpen,
      informationPanelMinimized,
      activeLeftTab,
      closeInformationPanel,
      setActiveLeftTab,
      informationNode,
      openInformationPanel,
      projection?.nodes,
      openLeftRailTab,
    ]
  );

  const selectMonitorKind = useCallback(
    (kind: GraphMonitorKind) => {
      const stub = () => {
        toast.message(
          `Monitor ${labelForMonitorKind(kind)} dashboard is not available from the Graph yet`
        );
      };

      switch (kind) {
        case "notifications":
        case "system-notices":
          handleLeftTabClick("notifications");
          return;
        case "attention": {
          const attentionNode =
            projection?.nodes.find((n) => Boolean(n.status?.attention)) ??
            projection?.nodes.find((n) => n.id === "hub:you");
          if (attentionNode) {
            openInformationPanel(attentionNode);
            return;
          }
          toast.message("No nodes need attention right now");
          return;
        }
        case "autonomous-reviews":
        case "automation-activity":
          handleLeftTabClick("projects");
          return;
        case "inference-status":
          openPanel({ tab: "chat" });
          void fetchAiStatus()
            .then((status) => {
              const model = status.modelName || "Local model";
              const tps =
                status.tokensPerSecond != null
                  ? ` · ${status.tokensPerSecond.toFixed(1)} t/s`
                  : "";
              toast.message(
                `Inference ${status.state}: ${model}${tps}${
                  status.healthOk ? "" : " (health check failed)"
                }`
              );
            })
            .catch(() => {
              toast.message("Could not read inference status");
            });
          return;
        case "prompt-queue":
          openPanel({ tab: "chat" });
          void fetchAiQueue()
            .then((res) => {
              const active = res.jobs.filter(
                (j) => j.status === "pending" || j.status === "running"
              ).length;
              toast.message(
                active > 0
                  ? `Prompt queue: ${active} active job(s)`
                  : "Prompt queue is empty"
              );
            })
            .catch(() => {
              toast.message("Could not read prompt queue");
            });
          return;
        case "runtime-health":
          openPanel({ tab: "chat" });
          void fetchAiStatus()
            .then((status) => {
              toast.message(
                status.healthOk
                  ? `Runtime healthy (${status.state})`
                  : `Runtime unhealthy (${status.state}${
                      status.error ? `: ${status.error}` : ""
                    })`
              );
            })
            .catch(() => {
              toast.message("Could not read runtime health");
            });
          return;
        case "runtime-logs":
          openPanel({ tab: "chat" });
          void fetchAiStatus()
            .then((status) => {
              const last = status.logs?.slice(-3).join(" · ").trim();
              toast.message(
                last
                  ? `Runtime logs: ${last}`
                  : "No recent runtime logs (open Intelligence for live status)"
              );
            })
            .catch(() => {
              toast.message("Could not read runtime logs");
            });
          return;
        case "platform-health":
          void fetchBridgeHealth()
            .then((health) => {
              toast.message(
                health.ok
                  ? `Platform healthy (${health.deploymentMode})`
                  : "Platform health check failed"
              );
            })
            .catch(() => {
              toast.message("Could not reach platform health");
            });
          return;
        case "embedding-engine":
        case "agent-activity":
          openAgentsSection("activity");
          return;
        case "missions":
          if (!openInfoNode("hub:you")) {
            handleLeftTabClick("info");
          }
          return;
        case "leaderboard":
          setTopTenOpen(true);
          return;
        case "ether-chat":
          setEtherChatOpen(true);
          window.dispatchEvent(new CustomEvent("godmode:show-chat"));
          return;
        case "bank-activity":
          handleLeftTabClick("bank");
          return;
        case "calendar-activity":
          handleLeftTabClick("calendar");
          return;
        case "vault-activity":
          handleLeftTabClick("vault");
          return;
        case "support":
          handleLeftTabClick("support");
          return;
        case "release-submissions":
          if (!authenticated) {
            toast.message("Sign in to view release submissions");
            return;
          }
          openByTab("releases");
          return;
        case "training-jobs":
        case "sync-jobs":
        case "webhook-delivery":
          stub();
          return;
        default: {
          const _exhaustive: never = kind;
          void _exhaustive;
          stub();
        }
      }
    },
    [
      authenticated,
      handleLeftTabClick,
      navigate,
      openAgentsSection,
      openByTab,
      openInfoNode,
      openInformationPanel,
      openPanel,
      projection?.nodes,
    ]
  );

  const selectEditKind = useCallback(
    (kind: GraphEditKind) => {
      const item = GRAPH_ACTION_EDIT_ITEMS.find((k) => k.id === kind);
      const label = labelForEditKind(kind);

      const requireAuth = () => {
        if (authenticated) return true;
        toast.message("Sign in to edit this");
        navigate("/?auth=1");
        return false;
      };

      const stub = () => {
        toast.message(
          `Edit ${label} dashboard is not available from the Graph yet`
        );
      };

      // Prefer selecting a Graph node when the target is instance-specific.
      if (kind === "chat") {
        toast.message("Select a chat node on the Graph to edit it");
        return;
      }
      if (kind === "workspace") {
        toast.message("Select a workspace node on the Graph to edit it");
        return;
      }
      if (kind === "digital-you") {
        if (!openInfoNode("hub:you")) {
          handleLeftTabClick("info");
        }
        return;
      }
      if (kind === "intelligence") {
        if (!openInfoNode("hub:intelligence")) {
          handleLeftTabClick("info");
        }
        return;
      }
      if (kind === "hub-settings") {
        if (!openInfoNode("hub:heart")) {
          stub();
        }
        return;
      }
      if (kind === "platform-vault") {
        openPlatformVault();
        return;
      }

      const cta = item?.cta;
      if (!cta || cta.type === "none" || cta.type === "select_kind") {
        stub();
        return;
      }

      if (cta.type === "navigate") {
        if (!requireAuth()) return;
        if (cta.path.startsWith(PLATFORM_VAULT_PATH)) {
          const q = cta.path.includes("?")
            ? new URLSearchParams(cta.path.split("?")[1])
            : null;
          openPlatformVault({
            vault: q?.get("vault"),
            sub: q?.get("sub"),
          });
          return;
        }
        if (cta.path.startsWith(ADMIN_PATH)) {
          const q = cta.path.includes("?")
            ? new URLSearchParams(cta.path.split("?")[1])
            : null;
          openAdmin({ tab: q?.get("tab") });
          return;
        }
        const surface = GRAPH_FLOATING_SURFACES.find(
          (s) =>
            cta.path === s.path || cta.path.startsWith(`${s.path}?`)
        );
        if (surface) {
          openByTab(surface.tab);
          return;
        }
        navigate(cta.path);
        return;
      }

      if (cta.type === "open_panel") {
        if (cta.tab === "platform-vault") {
          openPlatformVault();
          return;
        }
        const panelTab = cta.tab as string;
        if (panelTab === "admin") {
          openAdmin();
          return;
        }
        if (floatingSurfaceForTab(panelTab)) {
          openByTab(panelTab);
          return;
        }
        if ("subTab" in cta && cta.subTab) {
          openPanel({
            tab: "knowledge",
            knowledgeSubTab: cta.subTab,
          });
          return;
        }
        handleLeftTabClick(cta.tab as LeftRailTab);
        return;
      }

      if (cta.type === "open_chat") {
        if (kind === "models") {
          openPlatformVault({ vault: "inference", sub: "subscriptions" });
          return;
        }
        stub();
        return;
      }

      stub();
    },
    [
      authenticated,
      navigate,
      handleLeftTabClick,
      openAdmin,
      openByTab,
      openInfoNode,
      openPanel,
      openPlatformVault,
    ]
  );

  const selectOrganizeKind = useCallback(
    (kind: GraphOrganizeKind) => {
      const stub = () => {
        toast.message(
          `Organize ${labelForOrganizeKind(kind)} is not available from the Graph yet`
        );
      };

      switch (kind) {
        case "structure-editor":
        case "departments":
        case "divisions":
        case "pages-tree":
          if (!authenticated) {
            toast.message("Sign in to open Structure");
            navigate("/?auth=1");
            return;
          }
          openByTab("structure");
          return;
        case "vault-hierarchy":
          if (!authenticated) {
            toast.message("Sign in to open Vault");
            navigate("/?auth=1");
            return;
          }
          openByTab("personal-vault");
          return;
        case "workspaces-hierarchy":
          if (!openInfoNode("hub:workspace")) {
            stub();
          }
          return;
        case "owner-surfaces-hierarchy":
          if (!openInfoNode("hub:structure-you")) {
            stub();
          }
          return;
        case "expand-all":
          window.dispatchEvent(
            new CustomEvent("godmode:graph-organize-collapse", {
              detail: { action: "expand-all" },
            })
          );
          return;
        case "collapse-all":
          window.dispatchEvent(
            new CustomEvent("godmode:graph-organize-collapse", {
              detail: { action: "collapse-all" },
            })
          );
          return;
        case "reset-default-land":
          window.dispatchEvent(
            new CustomEvent("godmode:graph-organize-collapse", {
              detail: { action: "reset-default" },
            })
          );
          window.dispatchEvent(new CustomEvent("godmode:reset-graph-view"));
          return;
        case "reset-positions":
          window.dispatchEvent(new CustomEvent("godmode:reset-graph-view"));
          return;
        case "folders":
        case "expand-selected":
        case "collapse-selected":
        case "collapse-siblings":
        case "sort-by-name":
        case "sort-by-kind":
        case "sort-by-recency":
        case "sort-custom-order":
        case "manual-rearrange":
        case "pin-node":
        case "unpin-node":
        case "pin-to-top":
        case "manage-favorites":
        case "manage-tags":
        case "tag-selected":
        case "filter-by-tag":
        case "clear-tags":
        case "show-archived":
        case "archive-selected":
        case "restore-archived":
        case "hide-archived":
        case "auto-layout":
        case "group-by-workspace":
        case "group-by-department":
        case "declutter":
        case "save-layout":
        case "restore-layout":
          stub();
          return;
        default: {
          const _exhaustive: never = kind;
          void _exhaustive;
          stub();
        }
      }
    },
    [authenticated, navigate, openByTab, openInfoNode]
  );

  const selectConnectKind = useCallback(
    (kind: GraphConnectKind) => {
      const item = GRAPH_ACTION_CONNECT_ITEMS.find((k) => k.id === kind);
      const label = labelForConnectKind(kind);

      const requireAuth = () => {
        if (authenticated) return true;
        toast.message("Sign in to connect this");
        navigate("/?auth=1");
        return false;
      };

      const stub = () => {
        toast.message(
          `Connect ${label} is not available from the Graph yet`
        );
      };

      const cta = item?.cta;
      if (!cta || cta.type === "none") {
        stub();
        return;
      }

      if (cta.type === "navigate") {
        if (!requireAuth()) return;
        if (cta.path.startsWith(PLATFORM_VAULT_PATH)) {
          const q = cta.path.includes("?")
            ? new URLSearchParams(cta.path.split("?")[1])
            : null;
          openPlatformVault({
            vault: q?.get("vault"),
            sub: q?.get("sub"),
          });
          return;
        }
        if (cta.path.startsWith(ADMIN_PATH)) {
          const q = cta.path.includes("?")
            ? new URLSearchParams(cta.path.split("?")[1])
            : null;
          openAdmin({ tab: q?.get("tab") });
          return;
        }
        const surface = GRAPH_FLOATING_SURFACES.find(
          (s) =>
            cta.path === s.path || cta.path.startsWith(`${s.path}?`)
        );
        if (surface) {
          openByTab(surface.tab);
          return;
        }
        navigate(cta.path);
        return;
      }

      if (cta.type === "open_panel") {
        if (cta.tab === "platform-vault") {
          openPlatformVault();
          return;
        }
        const panelTab = cta.tab as string;
        if (panelTab === "admin") {
          openAdmin();
          return;
        }
        if (floatingSurfaceForTab(panelTab)) {
          openByTab(panelTab);
          return;
        }
        handleLeftTabClick(cta.tab as LeftRailTab);
        return;
      }

      if (cta.type === "open_chat") {
        setEtherChatOpen(true);
        toast.message("Use chat to attach an inference endpoint");
        return;
      }

      stub();
    },
    [authenticated, handleLeftTabClick, navigate, openAdmin, openByTab, openPlatformVault]
  );

  const selectValidateKind = useCallback(
    (kind: GraphValidateKind) => {
      const requireAuth = () => {
        if (authenticated) return true;
        toast.message("Sign in to run this check");
        navigate("/?auth=1");
        return false;
      };

      const stubCli = (cmd: string) => {
        toast.message(
          `${labelForValidateKind(kind)} runs via ${cmd} (not available from the Graph yet)`
        );
      };

      const stubSoon = () => {
        toast.message(
          `Validate ${labelForValidateKind(kind)} is not available from the Graph yet`
        );
      };

      switch (kind) {
        case "schema-kernel":
        case "objecttype-schema":
          void fetchObjectTypes()
            .then((types) => {
              toast.success(`ObjectType registry: ${types.length} type(s)`);
            })
            .catch(() => toast.error("ObjectType registry check failed"));
          return;
        case "kernel-parity":
          stubCli("npm run audit:kernel:parity");
          return;
        case "oss-audit":
          stubCli("npm run audit:oss");
          return;
        case "plugin-data-plane":
          stubCli("npm run audit:plugin-data-plane");
          return;
        case "cursor-attribution":
          stubCli("npm run audit:cursor-attribution");
          return;
        case "ai-tool-parity":
          stubCli("npm run audit:kernel:parity");
          return;
        case "release-verify":
          stubCli("npm run release:verify");
          return;
        case "test-gate":
          stubCli("npm run test:gate");
          return;
        case "bridge-health":
          void fetchBridgeHealth()
            .then((h) => {
              if (h.ok) toast.success(`Bridge healthy (${h.deploymentMode})`);
              else toast.error("Bridge health reported not ok");
            })
            .catch(() => toast.error("Bridge health check failed"));
          return;
        case "health-probes":
          stubSoon();
          return;
        case "embeddings-ready":
          if (!requireAuth()) return;
          openAdmin({ tab: "embeddings" });
          return;
        case "federation":
          if (!requireAuth()) return;
          openByTab("shared");
          return;
        case "mission-verify":
          if (!requireAuth()) return;
          void syncGraphMissions()
            .then((result) => {
              window.dispatchEvent(
                new CustomEvent("godmode:graph-missions-changed")
              );
              const awarded = result.awarded?.length ?? 0;
              toast.success(
                awarded > 0
                  ? `Missions verified. Awarded ${awarded} completion(s)`
                  : `Missions verified. ${result.missionsCompleted} complete, ${result.totalPoints} points`
              );
              reload();
            })
            .catch(() => toast.error("Mission verify failed"));
          return;
        case "graph-integrity":
          void fetchGraphProjection({ focusType: "architecture" })
            .then((proj) => {
              const ids = new Set(proj.nodes.map((n) => n.id));
              const broken = proj.edges.filter(
                (e) => !ids.has(e.source) || !ids.has(e.target)
              );
              if (proj.nodes.length === 0) {
                toast.message("Graph projection has no nodes");
              } else if (broken.length > 0) {
                toast.error(`Graph integrity: ${broken.length} broken edge(s)`);
              } else {
                toast.success(
                  `Graph integrity: ${proj.nodes.length} nodes, ${proj.edges.length} edges ok`
                );
              }
              setProjection(proj.nodes.length > 0 ? proj : null);
            })
            .catch(() => toast.error("Graph integrity check failed"));
          return;
        case "unlocks":
          if (!requireAuth()) return;
          void fetchChatUnlockStatus()
            .then((s) => {
              const entitled = s.unlockables.filter((u) => u.entitled).length;
              toast.success(
                `Unlocks: ${entitled}/${s.unlockables.length} entitled`
              );
            })
            .catch(() => toast.error("Unlock status check failed"));
          return;
        case "rules-lint":
          if (!requireAuth()) return;
          void fetchAiRules()
            .then((r) => {
              const rules = r.rules ?? [];
              const enabled = rules.filter((x) => x.enabled).length;
              toast.success(
                `Rules: ${rules.length} total, ${enabled} enabled`
              );
            })
            .catch(() => toast.error("Rules lint check failed"));
          return;
        case "permissions":
          if (!requireAuth()) return;
          openByTab("agents");
          return;
        case "authority-gates":
          if (!requireAuth()) return;
          openAdmin({ tab: "authority" });
          return;
        case "tool-allowlist":
          openPanel({ tab: "knowledge", knowledgeSubTab: "tools" });
          return;
        case "vault-secrets":
          handleLeftTabClick("vault");
          return;
        case "mfa-status":
          if (!requireAuth()) return;
          openByTab("settings");
          return;
        case "onboarding-llm-ready":
          openPlatformVault({ vault: "inference", sub: "subscriptions" });
          return;
        case "structure-integrity":
          if (!requireAuth()) return;
          openByTab("structure");
          return;
        case "marketplace-catalog":
          openByTab("marketplace");
          return;
        case "release-near-proof":
          if (!requireAuth()) return;
          openByTab("releases");
          return;
        case "signed-updates":
          if (!requireAuth()) return;
          openAdmin({ tab: "updates" });
          return;
        case "workspace-template":
          if (!requireAuth()) return;
          openAdmin({ tab: "template" });
          return;
        case "reflection-review":
          openPanel({ tab: "knowledge", knowledgeSubTab: "reflection" });
          return;
        case "support-verify":
          handleLeftTabClick("support");
          return;
        default: {
          const _exhaustive: never = kind;
          void _exhaustive;
          stubSoon();
        }
      }
    },
    [authenticated, navigate, reload, handleLeftTabClick, openAdmin, openByTab, openPanel, openPlatformVault]
  );

  const selectGovernKind = useCallback(
    (kind: GraphGovernKind) => {
      const requireAuth = () => {
        if (authenticated) return true;
        toast.message("Sign in to open governance controls");
        navigate("/?auth=1");
        return false;
      };

      const stub = () => {
        toast.message(
          `Govern ${labelForGovernKind(kind)} is not available from the Graph yet`
        );
      };

      switch (kind) {
        case "permissions":
          if (!requireAuth()) return;
          openByTab("shared");
          return;
        case "roles":
          if (!requireAuth()) return;
          openByTab("settings");
          return;
        case "share-grants":
          if (!requireAuth()) return;
          openByTab("shared");
          return;
        case "membership":
          openPlatformVault({ vault: "cloud" });
          return;
        case "users":
          if (!requireAuth()) return;
          openByTab("users");
          return;
        case "tool-autonomy":
        case "auto-accept-tools":
          setEtherChatOpen(true);
          toast.message(
            `${labelForGovernKind(kind)} is controlled in the Intelligence composer`
          );
          return;
        case "coding-authority":
        case "spend-authority":
        case "deploy-authority":
        case "delete-authority":
        case "send-authority":
        case "agent-pause":
        case "audit-logs":
          if (!requireAuth()) return;
          openAdmin({ tab: "authority" });
          return;
        case "vault-policies":
          if (!requireAuth()) return;
          openByTab("personal-vault");
          return;
        case "agent-vault":
          handleLeftTabClick("vault");
          return;
        case "platform-vault":
          openPlatformVault();
          return;
        case "secrets-policy":
          openPlatformVault({ vault: "secrets" });
          return;
        case "retention":
          if (!requireAuth()) return;
          openByTab("settings");
          return;
        case "observability":
          if (!requireAuth()) return;
          openAdmin({ tab: "observability" });
          return;
        case "support":
          openByTab("support");
          return;
        case "publish-rules":
        case "seller-policies":
          openByTab("marketplace");
          return;
        case "listing-policies":
          openByTab("marketplace");
          return;
        case "marketplace-fees":
          if (!requireAuth()) return;
          openAdmin({ tab: "marketplace" });
          return;
        case "esc-menu":
          window.dispatchEvent(new CustomEvent("godmode:open-esc-menu"));
          return;
        case "settings":
        case "appearance":
          if (!requireAuth()) return;
          openByTab("settings");
          return;
        case "account":
          if (!requireAuth()) return;
          openByTab("users");
          return;
        case "admin":
          if (!requireAuth()) return;
          openAdmin();
          return;
        case "workspace-template":
          if (!requireAuth()) return;
          openAdmin({ tab: "template" });
          return;
        default: {
          const _exhaustive: never = kind;
          void _exhaustive;
          stub();
        }
      }
    },
    [authenticated, navigate, handleLeftTabClick, openAdmin, openByTab, openPlatformVault]
  );

  useEffect(() => {
    const onShowChat = () => {
      setEtherChatOpen(true);
      setChatInboxOpen(true);
      openOrFocusChatWindow({
        kind: "agent",
        agentId: activeAgentId,
        title:
          activeAgentId === "intelligence"
            ? "Intelligence"
            : activeAgentId.charAt(0).toUpperCase() + activeAgentId.slice(1),
      });
    };
    window.addEventListener("godmode:show-chat", onShowChat);
    return () => window.removeEventListener("godmode:show-chat", onShowChat);
  }, [activeAgentId, openOrFocusChatWindow, setChatInboxOpen]);

  const ensureDefaultAgentWindow = useCallback(() => {
    openOrFocusChatWindow({
      kind: "agent",
      agentId: activeAgentId,
      title:
        activeAgentId === "intelligence"
          ? "Intelligence"
          : activeAgentId.charAt(0).toUpperCase() + activeAgentId.slice(1),
    });
  }, [activeAgentId, openOrFocusChatWindow]);

  const chatSurfaceOpen =
    chatInboxOpen || openChatWindows.some((w) => !w.minimized);

  const toggleEtherChat = useCallback(() => {
    if (chatSurfaceOpen || etherChatOpen) {
      setEtherChatOpen(false);
      setChatInboxOpen(false);
      closeAllChatWindows();
      return;
    }
    setEtherChatOpen(true);
    setChatInboxOpen(true);
    ensureDefaultAgentWindow();
  }, [
    chatSurfaceOpen,
    closeAllChatWindows,
    ensureDefaultAgentWindow,
    etherChatOpen,
    setChatInboxOpen,
  ]);

  // Desktop default: open Intelligence as a floating window (no ether tray).
  const bootstrappedChat = useRef(false);
  useEffect(() => {
    if (bootstrappedChat.current || !etherChatOpen) return;
    bootstrappedChat.current = true;
    ensureDefaultAgentWindow();
  }, [etherChatOpen, ensureDefaultAgentWindow]);

  const inboxUnread = useMemo(
    () => unreadCountsByKind(dmConversations),
    [dmConversations]
  );
  const showChatBadge = Math.max(dmUnreadCount, inboxUnread.total);

  const resetWindowAnchors = useCallback(() => {
    if (informationNode) openInformationPanel(informationNode);
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("godmode:reset-window-anchors"));
    });
  }, [
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

  const onNodeSelect = useCallback(
    (node: GraphProjectionNode) => {
      if (
        (node.kind === "chat" || node.kind === "agent") &&
        node.refId
      ) {
        setChatTarget({ kind: "agent", agentId: node.refId });
      } else if (node.id === "hub:you") {
        setChatTarget({ kind: "agent", agentId: "digital-you" });
      } else if (node.id === "hub:intelligence") {
        setChatTarget({ kind: "agent", agentId: "intelligence" });
      }
      openInformationPanel(node);
      if (
        node.openImmediate &&
        node.cta?.type === "open_panel" &&
        floatingSurfaceForTab(node.cta.tab)
      ) {
        openLeftRailTab(node.cta.tab as LeftRailTab);
      } else if (
        GRAPH_FLOATING_SURFACES.some((s) => s.nodeId === node.id)
      ) {
        const surface = GRAPH_FLOATING_SURFACES.find((s) => s.nodeId === node.id);
        if (surface) openLeftRailTab(surface.tab as LeftRailTab);
      }
    },
    [openInformationPanel, openLeftRailTab, setChatTarget]
  );

  const onNodeActivate = useCallback(
    (node: GraphProjectionNode) => {
      if (
        (node.kind === "chat" || node.kind === "agent") &&
        node.refId
      ) {
        setChatTarget({ kind: "agent", agentId: node.refId });
      } else if (node.id === "hub:you") {
        setChatTarget({ kind: "agent", agentId: "digital-you" });
      } else if (node.id === "hub:intelligence") {
        setChatTarget({ kind: "agent", agentId: "intelligence" });
      }
      openInformationPanel(node);
      if (
        node.openImmediate &&
        node.cta?.type === "open_panel" &&
        floatingSurfaceForTab(node.cta.tab)
      ) {
        openLeftRailTab(node.cta.tab as LeftRailTab);
      } else if (
        GRAPH_FLOATING_SURFACES.some((s) => s.nodeId === node.id)
      ) {
        const surface = GRAPH_FLOATING_SURFACES.find((s) => s.nodeId === node.id);
        if (surface) openLeftRailTab(surface.tab as LeftRailTab);
      }
    },
    [openInformationPanel, openLeftRailTab, setChatTarget]
  );

  // Live graphFilter ranks smart-suggest only. Camera zoom/focus runs on
  // explicit pick (Enter / click → pickSmartSuggest → selectNode), not typing.

  const actionCatalog = useMemo(
    () =>
      GRAPH_ACTION_MODES.map((mode) => ({
        mode: mode.id as GraphActionModeId,
        modeLabel: mode.label,
        items: graphActionItemsFor(mode.id),
      })),
    []
  );

  const selectActionItem = useCallback(
    (mode: GraphActionModeId, id: string) => {
      setGraphFilter("");
      if (mode === "create") selectCreateKind(id as GraphCreateKind);
      else if (mode === "edit") selectEditKind(id as GraphEditKind);
      else if (mode === "organize") selectOrganizeKind(id as GraphOrganizeKind);
      else if (mode === "connect") selectConnectKind(id as GraphConnectKind);
      else if (mode === "monitor") selectMonitorKind(id as GraphMonitorKind);
      else if (mode === "execute") selectExecuteKind(id as GraphExecuteKind);
      else if (mode === "validate") selectValidateKind(id as GraphValidateKind);
      else selectGovernKind(id as GraphGovernKind);
    },
    [
      selectCreateKind,
      selectEditKind,
      selectOrganizeKind,
      selectConnectKind,
      selectMonitorKind,
      selectExecuteKind,
      selectValidateKind,
      selectGovernKind,
    ]
  );

  const onComposerEscape = useCallback(() => {
    if (graphFilter) {
      setGraphFilter("");
      return;
    }
    composerInputRef.current?.blur();
  }, [graphFilter]);

  const composerPlaceholder =
    chatSurfaceOpen || etherChatOpen
      ? "Send follow-up"
      : "Ask Intelligence, search the Graph, or type an action…";

  useEffect(() => {
    const el = bottomChromeRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setBottomChromeWidth(w);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const smartSuggestions = useMemo(
    () =>
      buildSmartSuggestions({
        query: graphFilter,
        nodes: projection?.nodes ?? [],
        actionCatalog,
        limit: 12,
      }),
    [graphFilter, projection?.nodes, actionCatalog]
  );

  useEffect(() => {
    setSuggestIndex(0);
  }, [graphFilter]);

  const pickSmartSuggest = useCallback(
    (item: SmartSuggestItem) => {
      if (item.kind === "ask") {
        setEtherChatOpen(true);
        setSendRequestId((n) => n + 1);
        return;
      }
      if (item.kind === "node" && item.nodeId) {
        const node = projection?.nodes.find((n) => n.id === item.nodeId);
        if (node) {
          sceneRef.current?.selectNode(node.id);
          if (node.kind === "agent" && node.refId) {
            setChatTarget({ kind: "agent", agentId: node.refId });
          }
          openInformationPanel(node);
          if (
            node.cta?.type === "open_panel" &&
            floatingSurfaceForTab(node.cta.tab)
          ) {
            openLeftRailTab(node.cta.tab as LeftRailTab);
          } else {
            const surface = GRAPH_FLOATING_SURFACES.find(
              (s) => s.nodeId === node.id
            );
            if (surface) openLeftRailTab(surface.tab as LeftRailTab);
          }
        }
        setGraphFilter("");
        return;
      }
      if (item.kind === "action" && item.actionId && item.actionMode) {
        selectActionItem(item.actionMode, item.actionId);
      }
    },
    [openInformationPanel, openLeftRailTab, projection?.nodes, selectActionItem, setChatTarget]
  );

  const onSuggestEnter = useCallback((): boolean => {
    if (smartSuggestions.length === 0) return false;
    const item =
      smartSuggestions[
        Math.max(0, Math.min(suggestIndex, smartSuggestions.length - 1))
      ];
    if (!item) return false;
    pickSmartSuggest(item);
    return true;
  }, [pickSmartSuggest, smartSuggestions, suggestIndex]);

  const onSuggestArrow = useCallback(
    (dir: "up" | "down") => {
      if (smartSuggestions.length === 0) return;
      setSuggestIndex((i) => {
        if (dir === "down") return (i + 1) % smartSuggestions.length;
        return (i - 1 + smartSuggestions.length) % smartSuggestions.length;
      });
    },
    [smartSuggestions.length]
  );

  const persistLayout = useCallback(() => {
    if (!authenticated || !layoutDoc) return;
    void saveChatGraph(layoutDoc).catch(() => undefined);
  }, [authenticated, layoutDoc]);

  const empty = loaded && (projection?.nodes.length ?? 0) === 0;
  const emptyHint = useMemo(
    () =>
      "The Graph maps GodMode architecture. Click to select; double-click to open Information.",
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

      {/* Trophy (left) + light/dark (right): mirrored outer chrome */}
      <div className="pointer-events-auto absolute top-4 left-4 z-50">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="bg-background/80 shadow-sm backdrop-blur-sm"
                aria-label="Top 10 Board"
                onClick={() => setTopTenOpen(true)}
              />
            }
          >
            <TrophyIcon className="text-amber-500" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Top 10 Board</TooltipContent>
        </Tooltip>
      </div>
      <div className="pointer-events-auto absolute top-4 right-4 z-50">
        <ModeToggle
          size="icon-sm"
          variant="outline"
          className="bg-background/80 shadow-sm backdrop-blur-sm"
        />
      </div>

      {/* Centered top stack: ticker + system notice (full ticker width) */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center px-14">
        <div
          ref={bottomChromeRef}
          className="pointer-events-auto relative flex w-full max-w-2xl flex-col items-center gap-1.5"
        >
          {topNotice ? (
            <div className="w-full break-words rounded-md border border-border/60 bg-background/90 px-3 py-2 text-center text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              {topNotice}
            </div>
          ) : null}

          <GraphRareFindsTicker
            onOpenLeaderboard={() => setTopTenOpen(true)}
          />

          <GraphSystemNoticeBar
            onOpenNotifications={() => handleLeftTabClick("notifications")}
          />
        </div>
      </div>

      {/* Left-edge old chat window tabs: vertical icon stack mirroring right rail */}
      <div
        id="graph-left-tabs-rail"
        role="toolbar"
        aria-label="Workspace tools"
        className="pointer-events-auto absolute top-1/2 left-3 z-50 flex -translate-y-1/2 flex-col gap-1.5"
      >
        <GraphLeftTabIconButton
          label="Notifications"
          pressed={
            informationPanelOpen &&
            !informationPanelMinimized &&
            activeLeftTab === "notifications"
          }
          onClick={() => handleLeftTabClick("notifications")}
        >
          <BellIcon />
        </GraphLeftTabIconButton>
        <GraphLeftTabIconButton
          label="Calendar"
          pressed={
            informationPanelOpen &&
            !informationPanelMinimized &&
            activeLeftTab === "calendar"
          }
          onClick={() => handleLeftTabClick("calendar")}
        >
          <CalendarIcon />
        </GraphLeftTabIconButton>
        <GraphLeftTabIconButton
          label="Automations"
          pressed={
            informationPanelOpen &&
            !informationPanelMinimized &&
            activeLeftTab === "projects"
          }
          onClick={() => handleLeftTabClick("projects")}
        >
          <WorkflowIcon />
        </GraphLeftTabIconButton>
        <GraphLeftTabIconButton
          label="Knowledge"
          pressed={
            informationPanelOpen &&
            !informationPanelMinimized &&
            activeLeftTab === "knowledge"
          }
          onClick={() => handleLeftTabClick("knowledge")}
        >
          <BookOpenIcon />
        </GraphLeftTabIconButton>
        <GraphLeftTabIconButton
          label="Support"
          pressed={
            informationPanelOpen &&
            !informationPanelMinimized &&
            activeLeftTab === "support"
          }
          onClick={() => handleLeftTabClick("support")}
        >
          <LifeBuoyIcon />
        </GraphLeftTabIconButton>
      </div>

      {/* Right-edge graph tools: always visible vertical icon stack */}
      <div
        id="graph-tools-rail"
        role="toolbar"
        aria-label="Graph tools"
        className="pointer-events-auto absolute top-1/2 right-3 z-50 flex -translate-y-1/2 flex-col gap-1.5"
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

      {/* Bottom chrome: composer + chat toggle */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-50 flex items-end justify-center gap-3 px-4">
        <div
          className="pointer-events-auto flex w-full max-w-[calc(100%-3.5rem)] flex-col gap-2"
          style={{
            maxWidth: bottomChromeWidth
              ? `min(${bottomChromeWidth + 48}px, calc(100% - 3.5rem))`
              : "min(100% - 3.5rem, 48rem)",
          }}
        >
          <GraphSmartSuggest
            open={graphFilter.trim().length >= 1}
            items={smartSuggestions}
            activeIndex={suggestIndex}
            onActiveIndexChange={setSuggestIndex}
            onPick={pickSmartSuggest}
          />
          <GraphEtherComposer
            value={graphFilter}
            onValueChange={setGraphFilter}
            placeholder={composerPlaceholder}
            browseActive={smartSuggestions.length > 0}
            onSuggestEnter={onSuggestEnter}
            onSuggestArrow={onSuggestArrow}
            onAskForce={() => {
              setEtherChatOpen(true);
              ensureDefaultAgentWindow();
              setSendRequestId((n) => n + 1);
            }}
            sendRequestId={sendRequestId}
            onComposerEscape={onComposerEscape}
            inputRef={composerInputRef}
            statusChips={
              totalPoints != null ? (
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/50 bg-card/80 px-2.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`${totalPoints} points. Open Top 10 Board`}
                  onClick={() => setTopTenOpen(true)}
                >
                  <TrophyIcon className="size-3.5" />
                  <span>{totalPoints} pts</span>
                </button>
              ) : null
            }
          />
        </div>

        {/*
          Align with the h-12 composer input (not chips above it).
          (48px input − 28px icon-sm) / 2 = 10px lift from the shared bottom edge.
        */}
        <div className="pointer-events-auto flex shrink-0 items-end pb-2.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant={
                    chatSurfaceOpen || etherChatOpen ? "secondary" : "outline"
                  }
                  className="relative bg-background/80 shadow-sm backdrop-blur-sm"
                  aria-pressed={chatSurfaceOpen || etherChatOpen}
                  aria-label={
                    chatSurfaceOpen || etherChatOpen
                      ? "Hide chat"
                      : "Show chat"
                  }
                  onClick={toggleEtherChat}
                />
              }
            >
              {chatSurfaceOpen || etherChatOpen ? (
                <MessageSquareOff />
              ) : (
                <MessageSquare />
              )}
              {showChatBadge > 0 ? (
                <Badge className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[10px]">
                  {showChatBadge > 99 ? "99+" : showChatBadge}
                </Badge>
              ) : null}
            </TooltipTrigger>
            <TooltipContent>
              {chatSurfaceOpen || etherChatOpen ? "Hide chat" : "Show chat"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ChatInboxWindow
        composerText={graphFilter}
        onComposerDraftChange={setGraphFilter}
      />
      <ChatThreadWindowsHost
        composerText={graphFilter}
        onComposerDraftChange={setGraphFilter}
      />

      {/* focusId retained for future chat-focus merge */}
      <span className="sr-only" data-focus-chat={focusId} />

      <GraphTopTenBoardDialog
        open={topTenOpen}
        onOpenChange={setTopTenOpen}
      />

      <CreateWorkspaceDialog
        trigger={null}
        open={workspaceCreateOpen}
        onOpenChange={setWorkspaceCreateOpen}
      />
    </div>
  );
}
