import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  BotIcon,
  BrainIcon,
  ChevronDownIcon,
  ClockIcon,
  FileCodeIcon,
  ImageIcon,
  Maximize2Icon,
  MessageCircleIcon,
  Minimize2Icon,
  MinusIcon,
  PanelLeftIcon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { GRAPH_CHAT_WINDOW_Z } from "@/lib/graph-chrome-layout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  clampComposerWidth,
  clampPanelHeight,
  MIN_COMPOSER_WIDTH,
  useIntelligence,
  type PanelTab,
} from "@/lib/intelligence-context";
import {
  INTELLIGENCE_GREETING_HELLO,
  INTELLIGENCE_GREETING_QUESTION,
  INTELLIGENCE_INTERESTS,
  interestStartMessage,
} from "@/lib/intelligence-interests";
import { interestTour } from "@/lib/interest-tour";
import { CLOUD_GUIDE_DONE_EVENT, playCloudGuide } from "@/lib/cloud-guide";
import { AI_NAME } from "@/lib/navigation";
import { detectDesktopOsFromNavigator } from "@/lib/desktop-os";
import {
  canonicalGuideChoice,
  choiceOptionsForUserAgent,
  GUIDE_CHOICE_EVENT,
  type GuideChoiceCard,
} from "@/lib/guide-next-choice";
import {
  displayNameForAgent,
  fallbackAgentLabel,
  isPersonaAgent,
  sharesUserTooling,
} from "@/lib/focus-chrome";
import { ChatTurn } from "./ChatTurn";
import { useAiStatus } from "@/hooks/use-ai-status";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  focusWindowAnchors,
  snapToFocusAnchor,
} from "@/lib/floating-window-anchors";
import { snapRectToGrid } from "@/lib/floating-window-grid";
import {
  anchorWindowAndMirror,
  registerFloatingWindow,
  applyActiveFocusLayout,
  floatingTitleWindowIdAt,
  setTileSwapHighlight,
  swapFocusWindowSlots,
  setActiveFloatingWindow,
} from "@/lib/floating-window-registry";
import { useAgentMentionSources } from "@/hooks/use-agent-mention-sources";
import { useKanbanTodosForChat } from "@/hooks/use-kanban-todos-for-chat";
import {
  deleteAiChat,
  fetchAiAgent,
  fetchAiChats,
  fetchAiChat,
  fetchAiMessages,
  fetchAiQueue,
  fetchChatSession,
  startSharedChatSession,
  confirmAiTool,
  streamAiChat,
  truncateAiChat,
  deleteAiChatMessage,
  fetchAiArtifact,
  fetchDmMessages,
  fetchModelCatalog,
  getActiveTenantId,
  markDmConversationRead,
  sendDmMessage,
  refreshCursorSession,
  selectIntelligenceModel,
  type AiChat,
  type CatalogModel,
  type DmMessage,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import Bank from "@/pages/Bank";
import Vault from "@/pages/Vault";
import Support from "@/pages/Support";
import { CalendarBoard } from "./calendar/CalendarBoard";
import { AutomationsPanel } from "@/pages/Automations";
import { KnowledgePanel } from "@/pages/intelligence-flow/KnowledgePanel";
import { NotificationsList } from "@/components/NotificationsList";
import { ChatDirectorySidebar } from "./ChatDirectorySidebar";
import { ChatTargetSearch } from "./ChatTargetSearch";
import { ActiveWorkPanel } from "./projects/ActiveWorkPanel";
import { Markdown } from "./Markdown";
import { ArtifactViewerDialog, artifactViewerHref } from "./ArtifactViewerDialog";
import {
  applyGuideUiAction,
  cancelGraphTour,
  playGraphTour,
  GRAPH_TOUR_DONE_EVENT,
  GRAPH_TOUR_LINE_EVENT,
  GRAPH_TOUR_RESET_EVENT,
  guideUiActionFromToolResult,
} from "@/lib/guide-ui-action";
import { DigitalYouIcon } from "./DigitalYouIcon";
import {
  PartsBuilder,
  estimateTokens,
  partsToPlainText,
  partsAnswerText,
  type MsgPart,
} from "./chat-parts";
import { type ComposerSubmit } from "./IntelligenceComposer";
import { syncMissionsAfterChat } from "@/components/graph/GraphMissionsPanel";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[];
  thinking?: string | null;
  /** Structured Cursor-style parts for assistant turns (tools/thinking/todos/text). */
  parts?: MsgPart[];
  streaming?: boolean;
  /** Live status while waiting for the first token (e.g. Starting Cursor…). */
  statusText?: string;
  dmSenderKind?: "user" | "agent";
  dmSenderName?: string;
  isOwn?: boolean;
}

interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

class PanelErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: string | null; resetKey: string }
> {
  state = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : "Intelligence panel crashed",
    };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: string | null; resetKey: string }
  ) {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[intelligence] panel render failed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          Intelligence panel failed to render: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * The floating modal is constrained to the visible `<main>` rectangle. Because
 * it is rendered inside the center content column, these bounds are already
 * between the left sidebar, any right sidebar, the header, and the footer.
 */
function getPanelBounds(): PanelBounds {
  const main = document.querySelector("main");
  const parent = main?.parentElement;
  if (main && parent) {
    const m = main.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    if (m.width > 0 && m.height > 0) {
      return {
        x: Math.round(m.left - p.left),
        y: Math.round(m.top - p.top),
        width: Math.round(m.width),
        height: Math.round(m.height),
      };
    }
  }
  return {
    x: 0,
    y: 36,
    width: window.innerWidth,
    height: Math.max(240, window.innerHeight - 72),
  };
}

function clampPanelPos(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: PanelBounds
): { x: number; y: number } {
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - width);
  const maxY = Math.max(bounds.y, bounds.y + bounds.height - height);
  return {
    x: Math.round(Math.max(bounds.x, Math.min(maxX, x))),
    y: Math.round(Math.max(bounds.y, Math.min(maxY, y))),
  };
}

const SOCIAL_WINDOW_TABS = ["chat", "support"] as const;
const AGENT_WINDOW_TABS = [
  "projects",
  "calendar",
  "knowledge",
  "bank",
  "vault",
  "notifications",
] as const;

type SocialWindowTab = (typeof SOCIAL_WINDOW_TABS)[number];
type AgentWindowTab = (typeof AGENT_WINDOW_TABS)[number];

function isSocialWindowTab(tab: PanelTab): tab is SocialWindowTab {
  return (SOCIAL_WINDOW_TABS as readonly string[]).includes(tab);
}

function isAgentWindowTab(tab: PanelTab): tab is AgentWindowTab {
  return (AGENT_WINDOW_TABS as readonly string[]).includes(tab);
}

function ChatWindowTabs({
  tab,
  onTabChange,
}: {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}) {
  const group = isAgentWindowTab(tab) ? "agent" : "social";
  const [socialTab, setSocialTab] = useState<SocialWindowTab>("chat");
  const [agentTab, setAgentTab] = useState<AgentWindowTab>("projects");

  useEffect(() => {
    if (isSocialWindowTab(tab)) setSocialTab(tab);
    if (isAgentWindowTab(tab)) setAgentTab(tab);
  }, [tab]);

  const subtabClass = "min-w-max px-3 text-xs";

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1 pt-1">
      <Tabs
        value={group}
        onValueChange={(value) =>
          onTabChange(value === "agent" ? agentTab : socialTab)
        }
        className="px-2"
      >
        <TabsList className="h-9 w-full">
          <TabsTrigger value="social">Social</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as PanelTab)}
        className="min-w-0"
      >
        <TabsList
          variant="line"
          className="h-auto w-full min-w-0 flex-nowrap justify-start overflow-x-auto px-1 pb-1.5"
        >
          {group === "social" ? (
            <>
              <TabsTrigger value="chat" className={subtabClass}>Chat</TabsTrigger>
              <TabsTrigger value="support" className={subtabClass}>Support</TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="projects" className={subtabClass}>Automations</TabsTrigger>
              <TabsTrigger value="calendar" className={subtabClass}>Calendar</TabsTrigger>
              <TabsTrigger value="knowledge" className={subtabClass}>Knowledge</TabsTrigger>
              <TabsTrigger value="bank" className={subtabClass}>Bank</TabsTrigger>
              <TabsTrigger value="vault" className={subtabClass}>Agent Vault</TabsTrigger>
              <TabsTrigger value="notifications" className={subtabClass}>Notifications</TabsTrigger>
            </>
          )}
        </TabsList>
      </Tabs>
    </div>
  );
}

export function IntelligencePanel({
  chromeLocks,
}: {
  chromeLocks?: {
    lockClose?: boolean;
    lockResize?: boolean;
    lockCreate?: boolean;
    onLockedClose?: () => void;
    onLockedResize?: () => void;
    onLockedCreate?: () => void;
    onActiveChatId?: (id: string | null) => void;
  };
} = {}) {
  const {
    panelOpen,
    setPanelOpen,
    autoSendPrompt,
    setAutoSendPrompt,
    pendingChatId,
    setPendingChatId,
    buildPlatformContext,
    composerWidth,
    setComposerWidth,
    panelHeight,
    setPanelHeight,
    panelX,
    panelY,
    setPanelPos,
    panelTab,
    setPanelTab,
    activeAgentId,
    panelMaximized,
    setPanelMaximized,
    panelMinimized,
    setPanelMinimized,
    chatTarget,
    setChatTarget,
    dmConversations,
    refreshDmConversations,
    onDmIncomingMessage,
    artifactMentions,
    clearArtifactMentions,
    requestNewChat,
    clearNewChatRequest,
    toolAutonomy,
    chatMode,
    openPanel,
    setSeedText,
  } = useIntelligence();
  const lockClose = chromeLocks?.lockClose ?? false;
  const lockResize = chromeLocks?.lockResize ?? false;
  const lockCreate = chromeLocks?.lockCreate ?? false;
  const onLockedClose = chromeLocks?.onLockedClose;
  const onLockedResize = chromeLocks?.onLockedResize;
  const onLockedCreate = chromeLocks?.onLockedCreate;
  const { user, authenticated } = useTenant();
  const showChatDirectory = authenticated && user?.temporary !== true;
  const { status } = useAiStatus({ enabled: panelOpen });
  const [activeModel, setActiveModel] = useState<CatalogModel | null>(null);
  const [modelCatalog, setModelCatalog] = useState<CatalogModel[]>([]);
  const isMobile = useIsMobile();
  const [isPhone, setIsPhone] = useState<boolean>(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(max-width: 639px)").matches
  );
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const onChange = () => setIsPhone(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const onGreeting = (ev: Event) => {
      const detail = (ev as CustomEvent<{ ready?: boolean }>).detail;
      if (detail?.ready) {
        window.dispatchEvent(new CustomEvent("godmode:model-selected"));
      }
    };
    window.addEventListener("godmode:trial-greeting", onGreeting);
    return () => window.removeEventListener("godmode:trial-greeting", onGreeting);
  }, []);
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const isDmMode = chatTarget.kind === "conversation";
  const allowedTabs: PanelTab[] = [
    "chat",
    "support",
    "notifications",
    "calendar",
    "projects",
    "knowledge",
    "bank",
    "vault",
  ];
  const effectiveTab: PanelTab = allowedTabs.includes(panelTab)
    ? panelTab
    : "chat";
  const userTooling = sharesUserTooling(activeAgentId);
  useAgentMentionSources(
    activeAgentId,
    !isDmMode && panelOpen && effectiveTab === "chat"
  );
  const activeConversationId =
    chatTarget.kind === "conversation" ? chatTarget.conversationId : null;
  const activeConversation =
    activeConversationId
      ? dmConversations.find((c) => c.id === activeConversationId) ?? null
      : null;
  const dmMemberSummary =
    activeConversation?.members
      .map((m) => m.user?.displayName ?? m.agent?.name)
      .filter(Boolean)
      .join(", ") ?? "";
  const dmTitle = activeConversation?.displayTitle ?? "Conversation";
  const dmSubtitle =
    activeConversation?.kind === "group"
      ? dmMemberSummary
        ? `Group - ${dmMemberSummary}`
        : "Group conversation"
      : "Direct message";

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [tourLines, setTourLines] = useState<Array<{ label: string; say: string }>>([]);
  const [holdTourReply, setHoldTourReply] = useState(false);
  const [guideChoice, setGuideChoice] = useState<GuideChoiceCard | null>(null);
  const tourReplyId = useMemo(() => {
    if (tourLines.length === 0) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const row = messages[i];
      if (row.role === "assistant") return row.id;
    }
    return null;
  }, [messages, tourLines.length]);
  const [chats, setChats] = useState<AiChat[]>([]);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const kanbanTodoCards = useKanbanTodosForChat(
    activeAgentId,
    activeChatId,
    !isDmMode && effectiveTab === "chat"
  );
  const [busy, setBusy] = useState(false);
  // "Engine vs Work" UI state: whether the active agent is shared TO the user
  // (so chats save to THEIR workspace), the opt-in to contribute new memories
  // back to the agent owner, and whether this conversation is a shared session.
  const [agentShared, setAgentShared] = useState(false);
  const [agentName, setAgentName] = useState<string>(AI_NAME);
  const [contributeMemory, setContributeMemory] = useState(false);
  const [sharedSession, setSharedSession] = useState(false);
  const [sharingSession, setSharingSession] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [queuePending, setQueuePending] = useState(0);
  const pendingConfirmRef = useRef<PartsBuilder | null>(null);
  const pendingAssistantIdRef = useRef<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Refs let the singleton WS handler read live values without reconnecting.
  const activeChatIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const asideRef = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState<PanelBounds>(() => getPanelBounds());
  const isMaximized = panelMaximized;

  // Live context-usage meter: estimate tokens from the whole conversation
  // (including streamed parts) against the model's context window. Falls back to
  // a sensible window when no local model reports one (e.g. Cursor backend).
  const contextPct = useMemo(() => {
    const ctx = status?.ctxSize && status.ctxSize > 0 ? status.ctxSize : 128_000;
    const text = messages
      .map((m) =>
        m.role === "assistant" && m.parts?.length
          ? partsToPlainText(m.parts)
          : m.text
      )
      .join("\n");
    const tokens = estimateTokens(text);
    if (tokens <= 0) return 0;
    return Math.min(100, Math.max(1, Math.round((tokens / ctx) * 100)));
  }, [messages, status?.ctxSize]);

  useEffect(() => {
    const t = setInterval(() => {
      fetchAiQueue()
        .then((r) => setQueuePending(r.jobs.filter((j) => j.status === "pending" || j.status === "running").length))
        .catch(() => undefined);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  // viewport changes. Latest tile rect lives on the ref so a resize
  // does not pull a swapped chat window back to its mount position.
  const chatLayoutRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  useEffect(() => {
    const recompute = () => {
      const nextBounds = getPanelBounds();
      setBounds(nextBounds);
      const layout = chatLayoutRef.current;
      const width = clampComposerWidth(
        layout.width || composerWidth,
        nextBounds.width
      );
      const height = clampPanelHeight(
        layout.height || panelHeight,
        nextBounds.height
      );
      setComposerWidth(width);
      setPanelHeight(height);
      const focus = focusWindowAnchors(nextBounds, width, height);
      const pos = clampPanelPos(
        layout.width ? layout.x : (panelX ?? focus.left.x),
        layout.height ? layout.y : (panelY ?? focus.left.y),
        width,
        height,
        nextBounds
      );
      setPanelPos(pos.x, pos.y);
    };
    recompute();
    window.addEventListener("resize", recompute);
    // `<main>` width also changes when a right sidebar mounts/unmounts on route
    // changes (no window resize fires), which would leave bounds stale and let
    // a maximized panel spill under the sidebar. Observe the element directly.
    const main = document.querySelector("main");
    const observer = main ? new ResizeObserver(() => recompute()) : null;
    if (main && observer) observer.observe(main);
    return () => {
      window.removeEventListener("resize", recompute);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onReset = () => {
      if (isMaximized) return;
      const activeBounds = getPanelBounds();
      setBounds(activeBounds);
      const width = clampComposerWidth(composerWidth, activeBounds.width);
      const height = clampPanelHeight(panelHeight, activeBounds.height);
      setComposerWidth(width);
      setPanelHeight(height);
      const focus = focusWindowAnchors(activeBounds, width, height);
      setPanelPos(focus.left.x, focus.left.y);
      if (!panelOpen) setPanelOpen(true);
    };
    window.addEventListener("godmode:reset-window-anchors", onReset);
    return () =>
      window.removeEventListener("godmode:reset-window-anchors", onReset);
  }, [
    isMaximized,
    composerWidth,
    panelHeight,
    panelOpen,
    setComposerWidth,
    setPanelHeight,
    setPanelPos,
    setPanelOpen,
  ]);

  const [anchorPickMode, setAnchorPickMode] = useState(false);
  useEffect(() => {
    const onPick = (ev: Event) => {
      setAnchorPickMode(
        Boolean((ev as CustomEvent<{ active?: boolean }>).detail?.active)
      );
    };
    window.addEventListener("godmode:anchor-pick-mode", onPick);
    return () => window.removeEventListener("godmode:anchor-pick-mode", onPick);
  }, []);

  const handleDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const target = e.target;
    if (target instanceof Element && target.closest("button,[role='button']")) {
      return;
    }

    if (anchorPickMode) {
      e.preventDefault();
      e.stopPropagation();
      anchorWindowAndMirror("chat");
      window.dispatchEvent(
        new CustomEvent("godmode:anchor-pick-mode", {
          detail: { active: false },
        })
      );
      return;
    }

    setActiveFloatingWindow("chat");
    e.preventDefault();
    const activeBounds = getPanelBounds();
    setBounds(activeBounds);
    const startX = e.clientX;
    const startY = e.clientY;
    const focus = focusWindowAnchors(activeBounds, composerWidth, panelHeight);
    const startPanelX = panelX ?? focus.left.x;
    const startPanelY = panelY ?? focus.left.y;
    let lastX = startPanelX;
    let lastY = startPanelY;
    const onMove = (ev: PointerEvent) => {
      const pos = clampPanelPos(
        startPanelX + ev.clientX - startX,
        startPanelY + ev.clientY - startY,
        composerWidth,
        panelHeight,
        activeBounds
      );
      lastX = pos.x;
      lastY = pos.y;
      setPanelPos(pos.x, pos.y);
      setTileSwapHighlight(floatingTitleWindowIdAt(ev.clientX, ev.clientY, "chat"));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const swapTarget = floatingTitleWindowIdAt(ev.clientX, ev.clientY, "chat");
      setTileSwapHighlight(null);
      if (swapTarget && swapFocusWindowSlots("chat", swapTarget)) return;
      const focusSnapped = snapToFocusAnchor(
        lastX,
        lastY,
        composerWidth,
        panelHeight,
        activeBounds
      );
      if (focusSnapped) {
        setPanelPos(focusSnapped.x, focusSnapped.y);
      } else {
        const gridSnapped = snapRectToGrid(
          {
            x: lastX,
            y: lastY,
            width: composerWidth,
            height: panelHeight,
          },
          activeBounds
        );
        setPanelPos(gridSnapped.x, gridSnapped.y);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
  };

  const handleWidthResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const activeBounds = getPanelBounds();
    setBounds(activeBounds);
    const startX = e.clientX;
    const startWidth = composerWidth;
    const currentX =
      panelX ??
      focusWindowAnchors(activeBounds, composerWidth, panelHeight).left.x;
    const onMove = (ev: PointerEvent) => {
      const available = activeBounds.x + activeBounds.width - currentX;
      setComposerWidth(
        clampComposerWidth(startWidth + (ev.clientX - startX), available)
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  const handleHeightResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const activeBounds = getPanelBounds();
    setBounds(activeBounds);
    const startY = e.clientY;
    const startHeight = panelHeight;
    const currentY =
      panelY ?? activeBounds.y + activeBounds.height - panelHeight - 12;
    const onMove = (ev: PointerEvent) => {
      const available = activeBounds.y + activeBounds.height - currentY;
      setPanelHeight(
        clampPanelHeight(startHeight + (ev.clientY - startY), available)
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  const handleCornerResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const activeBounds = getPanelBounds();
    setBounds(activeBounds);
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = composerWidth;
    const startHeight = panelHeight;
    const currentX =
      panelX ??
      focusWindowAnchors(activeBounds, composerWidth, panelHeight).left.x;
    const currentY =
      panelY ?? activeBounds.y + activeBounds.height - panelHeight - 12;
    const onMove = (ev: PointerEvent) => {
      setComposerWidth(
        clampComposerWidth(
          startWidth + ev.clientX - startX,
          activeBounds.x + activeBounds.width - currentX
        )
      );
      setPanelHeight(
        clampPanelHeight(
          startHeight + ev.clientY - startY,
          activeBounds.y + activeBounds.height - currentY
        )
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  };

  const refreshChats = useCallback(() => {
    fetchAiChats()
      .then(setChats)
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  // Resolve whether the active agent is shared TO this user. When owned,
  // engine === work, so the ownership UI stays hidden and behavior is unchanged.
  useEffect(() => {
    let cancelled = false;
    if (!activeAgentId) {
      setAgentShared(false);
      setAgentName(AI_NAME);
      return;
    }
    fetchAiAgent(activeAgentId)
      .then((a) => {
        if (cancelled) return;
        setAgentShared(Boolean(a.shared));
        setAgentName(displayNameForAgent(a.id, a.name));
      })
      .catch(() => {
        if (!cancelled) {
          setAgentShared(false);
          setAgentName(fallbackAgentLabel(activeAgentId));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeAgentId]);

  // Resolve whether the open chat is already a collaborative shared session.
  useEffect(() => {
    let cancelled = false;
    if (!activeChatId) {
      setSharedSession(false);
      return;
    }
    fetchChatSession(activeChatId)
      .then((r) => {
        if (!cancelled) setSharedSession(r.shared);
      })
      .catch(() => {
        if (!cancelled) setSharedSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  const handleShareSession = useCallback(async () => {
    if (!activeChatId) {
      toast.error("Send a message first, then share the conversation.");
      return;
    }
    setSharingSession(true);
    try {
      await startSharedChatSession(activeChatId, activeAgentId);
      setSharedSession(true);
      toast.success("Conversation shared. Collaborators can now join live.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share conversation");
    } finally {
      setSharingSession(false);
    }
  }, [activeChatId, activeAgentId]);

  const loadChat = useCallback(
    async (chatId: string) => {
      try {
        const stored = await fetchAiMessages(chatId);
        setMessages(
          stored.map((m) => {
            const answer =
              m.role === "user"
                ? m.content.text ?? ""
                : m.content.answer ?? m.content.content ?? "";
            const storedParts = Array.isArray(m.content.parts)
              ? (m.content.parts as MsgPart[])
              : undefined;
            // Reconstruct parts from legacy thinking+answer when none persisted.
            const parts: MsgPart[] | undefined =
              m.role === "assistant"
                ? storedParts && storedParts.length
                  ? storedParts
                  : [
                      ...(m.content.thinking
                        ? [
                            {
                              kind: "thinking" as const,
                              text: m.content.thinking,
                              startedAt: 0,
                              endedAt: 0,
                            },
                          ]
                        : []),
                      ...(answer
                        ? [{ kind: "text" as const, text: answer }]
                        : []),
                    ]
                : undefined;
            return {
              id: m.id,
              role: m.role,
              text: answer,
              images: m.content.images,
              thinking: m.content.thinking ?? null,
              parts,
            };
          })
        );
        setActiveChatId(chatId);
      } catch {
        setErrorMsg("Failed to load chat");
        setErrorCode(null);
      }
    },
    []
  );

  const recoverAfterBridgeDrop = useCallback(
    async (chatId: string) => {
      const deadline = Date.now() + 120_000;
      let delayMs = 0;
      while (Date.now() < deadline) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(Math.max(delayMs, 400) * 2, 8000);
        if (activeChatIdRef.current !== chatId) return;
        try {
          const [stored, chat] = await Promise.all([
            fetchAiMessages(chatId),
            fetchAiChat(chatId),
          ]);
          const status = chat.turn_state?.status;
          const hasAssistant = stored.some((m) => m.role === "assistant");
          if (status === "resuming" || status === "running") {
            setBusy(true);
            busyRef.current = true;
            setErrorMsg(null);
            setErrorCode(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.role === "assistant" &&
                (m.streaming || m.text?.startsWith("⚠️"))
                  ? {
                      ...m,
                      streaming: true,
                      statusText: "Bridge restarted. Continuing this turn.",
                      text: m.text?.startsWith("⚠️") ? "" : m.text,
                    }
                  : m
              )
            );
            continue;
          }
          if (hasAssistant) {
            await loadChat(chatId);
            setErrorMsg(null);
            setErrorCode(null);
            setBusy(false);
            busyRef.current = false;
            return;
          }
          if (status === "interrupted_failed") {
            await loadChat(chatId);
            setErrorMsg(
              "This turn did not recover after a Bridge restart. Send again if needed."
            );
            setErrorCode(null);
            setBusy(false);
            busyRef.current = false;
            return;
          }
          // Idle with no assistant: user Stop or a finished error. Do not poll.
          setBusy(false);
          busyRef.current = false;
          return;
        } catch {
          /* Bridge is still coming up. Keep polling until the deadline. */
        }
      }
      if (activeChatIdRef.current === chatId) {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [loadChat]
  );

  useEffect(() => {
    if (pendingChatId) {
      void loadChat(pendingChatId);
      setPendingChatId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChatId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, tourLines, holdTourReply, guideChoice]);

  useEffect(() => {
    const onLine = (ev: Event) => {
      const detail = (ev as CustomEvent<{ label?: string; say?: string }>).detail;
      const say = detail?.say?.trim();
      if (!say) return;
      setHoldTourReply(true);
      setTourLines((prev) => [
        ...prev,
        { label: detail.label?.trim() || "Graph", say },
      ]);
    };
    const onReset = () => {
      setTourLines([]);
      setHoldTourReply(false);
      setGuideChoice(null);
    };
    const onDone = () => {
      setHoldTourReply(false);
      setGuideChoice((current) => current ?? canonicalGuideChoice());
    };
    const onChoice = (ev: Event) => {
      const detail = (ev as CustomEvent<GuideChoiceCard>).detail;
      if (!detail?.options?.length) return;
      setGuideChoice({
        question: detail.question,
        why: detail.why,
        options: detail.options,
      });
    };
    const onCloudDone = () => setHoldTourReply(false);
    window.addEventListener(GRAPH_TOUR_LINE_EVENT, onLine);
    window.addEventListener(GRAPH_TOUR_RESET_EVENT, onReset);
    window.addEventListener(GRAPH_TOUR_DONE_EVENT, onDone);
    window.addEventListener(CLOUD_GUIDE_DONE_EVENT, onCloudDone);
    window.addEventListener(GUIDE_CHOICE_EVENT, onChoice);
    return () => {
      window.removeEventListener(GRAPH_TOUR_LINE_EVENT, onLine);
      window.removeEventListener(GRAPH_TOUR_RESET_EVENT, onReset);
      window.removeEventListener(GRAPH_TOUR_DONE_EVENT, onDone);
      window.removeEventListener(CLOUD_GUIDE_DONE_EVENT, onCloudDone);
      window.removeEventListener(GUIDE_CHOICE_EVENT, onChoice);
      cancelGraphTour();
    };
  }, []);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Multi-device live updates: subscribe to the active agent's room (server also
  // broadcasts to the tenant room every connection auto-joins) and refresh when
  // a chat_message arrives that this device did not just stream itself.
  useEffect(() => {
    if (!activeAgentId) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    let sock: WebSocket | null = null;
    let closed = false;
    const tenantId = getActiveTenantId();
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    try {
      sock = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
    } catch {
      return;
    }
    sock.onopen = () => {
      sock?.send(
        JSON.stringify({ type: "join_resource", kind: "agent", resourceId: activeAgentId })
      );
    };
    sock.onmessage = (ev) => {
      let msg: { type?: string; data?: { chatId?: string } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "chat_message") {
        refreshChats();
        const chatId = msg.data?.chatId;
        // Reload only when another device/participant produced the message
        // (this device skips its own in-flight stream to avoid clobbering it).
        if (chatId && chatId === activeChatIdRef.current && !busyRef.current) {
          void loadChat(chatId);
        }
      } else if (msg.type === "chat_session_shared") {
        if (msg.data?.chatId && msg.data.chatId === activeChatIdRef.current) {
          setSharedSession(true);
        }
      }
    };
    return () => {
      closed = true;
      try {
        if (sock && sock.readyState <= 1) sock.close();
      } catch {
        /* ignore */
      }
      void closed;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId]);

  const dmToUi = useCallback(
    (m: DmMessage): UiMessage => {
      const isOwn = m.senderKind === "user" && m.senderUserId === user?.id;
      const agentName = m.senderAgent?.name ?? "Agent";
      const humanName = m.sender?.displayName ?? "User";
      const imageHrefs = m.attachments
        .filter((a) => a.kind === "image" && a.href)
        .map((a) => a.href!);
      return {
        id: m.id,
        role: m.senderKind === "agent" ? "assistant" : isOwn ? "user" : "assistant",
        text: m.bodyText,
        images: imageHrefs.length ? imageHrefs : undefined,
        dmSenderKind: m.senderKind,
        dmSenderName: m.senderKind === "agent" ? agentName : humanName,
        isOwn,
      };
    },
    [user?.id]
  );

  const loadDmConversation = useCallback(
    async (conversationId: string) => {
      try {
        const res = await fetchDmMessages(conversationId, { limit: 100 });
        setMessages(res.messages.map(dmToUi));
        const last = res.messages[res.messages.length - 1];
        if (last) {
          await markDmConversationRead(conversationId, last.id);
          void refreshDmConversations();
        }
      } catch {
        setErrorMsg("Failed to load conversation");
        setErrorCode(null);
      }
    },
    [dmToUi, refreshDmConversations]
  );

  useEffect(() => {
    if (!activeConversationId) return;
    void loadDmConversation(activeConversationId);
  }, [activeConversationId, loadDmConversation]);

  useEffect(() => {
    if (!activeConversationId) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const tenantId = getActiveTenantId();
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    const sock = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
    sock.onopen = () => {
      sock.send(
        JSON.stringify({
          type: "join_resource",
          kind: "conversation",
          resourceId: activeConversationId,
        })
      );
    };
    return () => sock.close();
  }, [activeConversationId]);

  useEffect(() => {
    return onDmIncomingMessage((msg, convId) => {
      if (convId !== activeConversationId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, dmToUi(msg)];
      });
      void markDmConversationRead(convId, msg.id);
      void refreshDmConversations();
    });
  }, [activeConversationId, onDmIncomingMessage, dmToUi, refreshDmConversations]);

  useEffect(() => {
    if (chatTarget.kind === "agent") {
      setMessages([]);
      setActiveChatId(null);
    }
  }, [chatTarget]);

  const newChat = () => {
    abortRef.current?.();
    setMessages([]);
    if (isDmMode) {
      setChatTarget({ kind: "agent", agentId: activeAgentId });
    } else {
      setActiveChatId(null);
    }
    setErrorMsg(null);
    setErrorCode(null);
  };

  useEffect(() => {
    if (!requestNewChat) return;
    newChat();
    clearNewChatRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when discuss-in-chat requests a fresh thread
  }, [requestNewChat, clearNewChatRequest]);

  const handleDeleteChat = async (id: string) => {
    await deleteAiChat(id).catch(() => undefined);
    if (id === activeChatId) newChat();
    refreshChats();
  };

  const copyMessage = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast("Copied"));
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!activeChatId) return;
    await deleteAiChatMessage(activeChatId, messageId).catch(() => undefined);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  const handleRegenerate = async (assistantMsgId: string) => {
    if (!activeChatId || busy) return;
    const idx = messages.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const priorUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (!priorUser) return;
    const priorUserIdx = messages.findIndex((m) => m.id === priorUser.id);
    const keepThrough =
      priorUserIdx > 0 ? messages[priorUserIdx - 1] : null;
    if (keepThrough) {
      await truncateAiChat(activeChatId, keepThrough.id).catch(() => undefined);
    }
    setMessages(messages.slice(0, priorUserIdx));
    void send({ text: priorUser.text, images: priorUser.images ?? [], mentionIds: [] });
  };

  const startInterestTour = (interestId: string) => {
    if (busy) return;
    const text = interestStartMessage(interestId);
    const stops = interestTour(interestId);
    if (!text || !stops) return;
    setErrorMsg(null);
    setErrorCode(null);
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text },
    ]);
    playGraphTour(stops);
  };

  const startCloudGuide = (label: string) => {
    if (busy) return;
    setErrorMsg(null);
    setErrorCode(null);
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: label },
    ]);
    playCloudGuide();
  };

  const send = async ({
    text,
    images,
    mentionIds,
    dmAttachments,
    interestId,
    pathId,
  }: ComposerSubmit) => {
    if (busy) return;
    cancelGraphTour();
    setErrorMsg(null);
    setErrorCode(null);

    if (isDmMode && activeConversationId) {
      const userMsg: UiMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text,
        images,
        isOwn: true,
      };
      setMessages((prev) => [...prev, userMsg]);
      setBusy(true);
      try {
        const res = await sendDmMessage(activeConversationId, {
          bodyText: text,
          attachments: dmAttachments,
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsg.id ? dmToUi(res.message) : m))
        );
        void refreshDmConversations();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Send failed");
        setErrorCode(null);
      } finally {
        setBusy(false);
      }
      return;
    }

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      images,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: "assistant",
        text: "",
        parts: [],
        streaming: true,
        statusText: "Working…",
      },
    ]);
    setBusy(true);
    busyRef.current = true;

    const history = messages.map((m) => ({
      role: m.role,
      content: m.text,
      ...(m.role === "assistant" && m.parts?.length
        ? {
            parts: m.parts.map((p) => {
              if (p.kind === "text") return { kind: "text", text: p.text };
              if (p.kind === "thinking") return { kind: "thinking", text: p.text };
              if (p.kind === "tool")
                return {
                  kind: "tool",
                  id: p.id,
                  name: p.name,
                  args: p.args,
                  status: p.status,
                  result: p.result,
                };
              if (p.kind === "todos") return { kind: "todos", items: p.items };
              return { kind: "text", text: "" };
            }),
          }
        : {}),
    }));

    const platformContext = await buildPlatformContext(mentionIds);
    if (artifactMentions.length > 0) {
      const artifactSources = await Promise.all(
        artifactMentions.map(async (a) => {
          try {
            const r = await fetchAiArtifact(a.id, activeAgentId, true);
            return {
              id: `artifact:${a.id}`,
              label: a.name,
              data: {
                id: a.id,
                name: r.name,
                kind: r.kind,
                description: r.description,
                content: r.content,
              },
            };
          } catch {
            return {
              id: `artifact:${a.id}`,
              label: a.name,
              data: { id: a.id, name: a.name, error: "failed to load artifact content" },
            };
          }
        })
      );
      platformContext.mentionedSources = [
        ...(platformContext.mentionedSources ?? []),
        ...artifactSources,
      ];
    }

    // Incremental builder that turns SSE events into interleaved parts.
    const builder = new PartsBuilder();
    const sync = () =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, parts: builder.snapshot() } : m
        )
      );

    abortRef.current = streamAiChat(
      {
        chatId: activeChatId ?? undefined,
        message: text,
        history,
        platformContext,
        images,
        agentId: activeAgentId,
        contributeMemory: agentShared ? contributeMemory : undefined,
        chatMode,
        toolAutonomy,
        autoAcceptTools: toolAutonomy === "full",
        interestId,
        pathId,
        clientOs:
          interestId || pathId
            ? detectDesktopOsFromNavigator() ?? undefined
            : undefined,
      },
      {
        onChatId: (chatId) => {
          activeChatIdRef.current = chatId;
          if (!activeChatId) setActiveChatId(chatId);
        },
        onStatus: ({ message }) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && m.streaming
                ? { ...m, statusText: message }
                : m
            )
          );
        },
        onToken: (content) => {
          builder.onToken(content);
          sync();
        },
        onReasoning: (content) => {
          builder.onReasoning(content);
          sync();
        },
        onToolCall: (name, args, toolCallId) => {
          builder.onToolCall(name, args, toolCallId ?? `t-${Date.now()}`);
          sync();
        },
        onToolCallDelta: (toolCallId, name, args) => {
          builder.onToolCallDelta(toolCallId, name, args);
          sync();
        },
        onToolResult: (name, result, toolCallId, isError) => {
          builder.onToolResult(
            toolCallId ?? "",
            result,
            isError ?? false
          );
          if (
            !isError &&
            name === "save_artifact" &&
            result &&
            typeof result === "object" &&
            "id" in result
          ) {
            const saved = result as { id: string; name?: string };
            const label = saved.name ?? "artifact";
            builder.onToken(
              `\n\n[Open **${label}**](${artifactViewerHref(saved.id)})\n`
            );
          }
          if (!isError) {
            const uiAction = guideUiActionFromToolResult(result);
            if (uiAction) applyGuideUiAction(uiAction);
          }
          sync();
        },
        onTerminalOutput: ({ toolCallId, stream, text }) => {
          builder.onTerminalOutput(toolCallId, stream, text);
          sync();
        },
        onTerminalMonitor: ({ toolCallId, text }) => {
          builder.onTerminalMonitor(toolCallId, text);
          sync();
        },
        onDone: (data) => {
          const finalParts = builder.finalize();
          clearArtifactMentions();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    parts: finalParts,
                    text:
                      partsAnswerText(finalParts) ||
                      data.answer ||
                      data.content,
                    thinking: data.thinking,
                    streaming: false,
                    statusText: undefined,
                  }
                : m
            )
          );
          setBusy(false);
          busyRef.current = false;
          abortRef.current = null;
          refreshChats();
          void syncMissionsAfterChat();
        },
        onError: (error, code, meta) => {
          const raw =
            String(error ?? "").trim() ||
            "Chat connection dropped. Try sending again.";
          const staleFromMsg = raw.includes("CURSOR_SESSION_STALE");
          const errorText = raw.replace(/^CURSOR_SESSION_STALE:\s*/i, "");
          if (meta?.payPath) setTrialPayPath(meta.payPath);
          if (meta?.convertHint) setTrialConvertHint(meta.convertHint);
          if (meta?.cloudSeatPath != null)
            setTrialCloudSeatPath(meta.cloudSeatPath);
          if (meta?.cloudSeatCtaLabel != null)
            setTrialCloudSeatCta(meta.cloudSeatCtaLabel);
          const convertLine = meta?.convertHint
            ? `\n\n${meta.convertHint}`
            : "";
          const display = `⚠️ ${errorText}${convertLine}`;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    parts: [
                      ...builder.finalize(),
                      { kind: "text", text: display },
                    ],
                    text: display,
                    streaming: false,
                    statusText: undefined,
                  }
                : m
            )
          );
          setErrorMsg(errorText);
          setErrorCode(
            code === "CURSOR_SESSION_STALE" || staleFromMsg
              ? "CURSOR_SESSION_STALE"
              : code ?? null
          );
          setBusy(false);
          busyRef.current = false;
          abortRef.current = null;
          const chatId = activeChatIdRef.current;
          if (chatId) void recoverAfterBridgeDrop(chatId);
        },
        onToolConfirmRequired: (payload) => {
          builder.onToolConfirmRequired(payload.toolCallId, {
            previewDiff: payload.previewDiff,
            previewError: payload.previewError,
          });
          pendingConfirmRef.current = builder;
          pendingAssistantIdRef.current = assistantId;
          sync();
          if (toolAutonomy === "full") {
            const chatId = activeChatIdRef.current;
            if (chatId) void confirmAiTool(payload.toolCallId, true, chatId);
          }
        },
      }
    );
  };

  // Auto-send onboarding or launcher prompts (e.g. "Create New Agent").
  useEffect(() => {
    if (!autoSendPrompt || !panelOpen || effectiveTab !== "chat" || busy) return;
    const text = autoSendPrompt;
    setAutoSendPrompt(null);
    void send({ text, images: [], mentionIds: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendPrompt, panelOpen, panelTab, busy, setAutoSendPrompt]);

  const resolveInlineToolConfirm = useCallback((toolCallId: string, approved: boolean) => {
    const builder = pendingConfirmRef.current;
    const assistantId = pendingAssistantIdRef.current;
    if (builder && assistantId) {
      if (approved) builder.markToolRunning(toolCallId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, parts: builder.snapshot() } : m
        )
      );
    }
    const chatId = activeChatIdRef.current;
    if (chatId) void confirmAiTool(toolCallId, approved, chatId);
  }, []);

  const handleApproveTool = useCallback(
    (toolCallId: string) => resolveInlineToolConfirm(toolCallId, true),
    [resolveInlineToolConfirm]
  );

  const handleDenyTool = useCallback(
    (toolCallId: string) => resolveInlineToolConfirm(toolCallId, false),
    [resolveInlineToolConfirm]
  );

  const stop = () => {
    abortRef.current?.();
    abortRef.current = null;
    setBusy(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  };

  const running = status?.state === "running";

  const catalogBySource = useMemo(() => {
    const groups: Record<CatalogModel["source"], CatalogModel[]> = {
      local: [],
      cursor: [],
      provider: [],
      remote: [],
    };
    for (const m of modelCatalog) {
      if (m?.source && groups[m.source]) groups[m.source].push(m);
    }
    return groups;
  }, [modelCatalog]);

  const catalogGodModeInference = useMemo(
    () =>
      catalogBySource.provider.filter((m) => m.managedGodModeInference),
    [catalogBySource.provider]
  );
  const catalogVaultProviders = useMemo(
    () =>
      catalogBySource.provider.filter((m) => !m.managedGodModeInference),
    [catalogBySource.provider]
  );

  const signedOutModel =
    catalogGodModeInference.find((m) => m.active) ??
    catalogGodModeInference[0] ??
    null;
  const shownModel = authenticated ? activeModel : signedOutModel;

  const modelLabel =
    shownModel?.label ??
    (!authenticated
      ? "Select model"
      : running
        ? status?.modelName?.replace(/\.gguf$/i, "") ?? "Model"
        : status?.state === "starting"
          ? "Starting…"
          : "Select model");

  const modelDotClass =
    shownModel?.source === "local"
      ? running
        ? "bg-emerald-500"
        : status?.state === "starting"
          ? "bg-amber-500"
          : "bg-muted-foreground/60"
      : shownModel
        ? "bg-sky-500"
        : "bg-muted-foreground/60";

  const handleCatalogSelect = useCallback(
    async (model: CatalogModel) => {
      try {
        const res = await selectIntelligenceModel({
          id: model.id,
          source: model.source,
          path: model.path,
          model: model.model,
          provider: model.provider,
          endpointId: model.endpointId,
          transport: model.transport,
        });
        if (!res.active || typeof res.active.id !== "string") {
          throw new Error("Model catalog returned no active model");
        }
        setActiveModel(res.active);
        setModelCatalog((prev) =>
          prev
            .filter((m) => m && typeof m.id === "string")
            .map((m) => ({ ...m, active: m.id === res.active.id }))
        );
        window.dispatchEvent(new Event("godmode:model-selected"));
        toast.success(`Using ${res.active.label}`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to switch model"
        );
      }
    },
    []
  );

  useEffect(() => {
    if (!panelOpen || isDmMode) return;
    let cancelled = false;
    const refreshModel = () => {
      fetchModelCatalog()
        .then((r) => {
          if (cancelled) return;
          setActiveModel(r.active);
          setModelCatalog(
            (r.models ?? []).filter((m) => m && typeof m.id === "string")
          );
        })
        .catch(() => {
          if (cancelled) return;
          setActiveModel(null);
          setModelCatalog([]);
        });
    };
    refreshModel();
    const onModelSelected = () => refreshModel();
    window.addEventListener("godmode:model-selected", onModelSelected);
    return () => {
      cancelled = true;
      window.removeEventListener("godmode:model-selected", onModelSelected);
    };
  }, [panelOpen, isDmMode]);

  const maxPairedWidth =
    bounds.width < 1440
      ? Math.max(MIN_COMPOSER_WIDTH, Math.floor((bounds.width - 120) / 2))
      : bounds.width;
  const currentWidth = clampComposerWidth(composerWidth, maxPairedWidth);
  const currentHeight = clampPanelHeight(panelHeight, bounds.height);
  const focus = focusWindowAnchors(bounds, currentWidth, currentHeight);
  const defaultX = focus.left.x;
  const defaultY = focus.left.y;
  const pos = clampPanelPos(
    panelX ?? defaultX,
    panelY ?? defaultY,
    currentWidth,
    currentHeight,
    bounds
  );

  chatLayoutRef.current = {
    x: pos.x,
    y: pos.y,
    width: currentWidth,
    height: currentHeight,
  };

  useEffect(() => {
    if (!panelOpen || isMaximized || isMobile) return;
    const unregister = registerFloatingWindow({
      id: "chat",
      role: "chat",
      pairGroup: "focus-pair",
      getLayout: () => chatLayoutRef.current,
      applyLayout: (rect) => {
        chatLayoutRef.current = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
        setPanelPos(rect.x, rect.y);
        setComposerWidth(rect.width);
        setPanelHeight(rect.height);
      },
    });
    const id = requestAnimationFrame(() => applyActiveFocusLayout());
    return () => {
      cancelAnimationFrame(id);
      unregister();
    };
  }, [
    panelOpen,
    isMaximized,
    isMobile,
    setPanelPos,
    setComposerWidth,
    setPanelHeight,
  ]);

  if (!panelOpen) return null;

  const panelAccent = isDmMode ? "#38bdf8" : "#a78bfa";
  const panelShadow = isLight
    ? `0 18px 40px -18px rgb(15 23 42 / 0.28), 0 0 0 1px ${panelAccent}40`
    : `0 16px 48px -16px ${panelAccent}99`;
  const panelBorder = isLight ? `${panelAccent}55` : `${panelAccent}88`;
  const panelBorderMax = isLight ? `${panelAccent}40` : `${panelAccent}66`;

  return (
    <aside
      ref={asideRef}
      aria-hidden={panelMinimized ? true : undefined}
      style={
        panelMinimized
          ? { display: "none" }
          : isPhone
            ? undefined
            : isMaximized
              ? {
                  left: bounds.x,
                  top: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                  maxWidth: bounds.width,
                  maxHeight: bounds.height,
                  borderColor: panelBorderMax,
                }
              : {
                  left: pos.x,
                  top: pos.y,
                  width: currentWidth,
                  height: currentHeight,
                  maxWidth: bounds.width,
                  maxHeight: bounds.height,
                  borderColor: panelBorder,
                  boxShadow: panelShadow,
                }
      }
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-muted text-foreground shadow-xl",
        isPhone
          ? "fixed inset-0 z-50"
          : `absolute ${GRAPH_CHAT_WINDOW_Z} rounded-xl border-2 shadow-2xl`
      )}
    >
      {!isPhone && !isMaximized && !lockResize && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize Intelligence height"
            title="Drag to resize"
            onPointerDown={handleHeightResize}
            className={cn(
              "group absolute bottom-0 left-0 z-10 flex h-1.5 w-full cursor-ns-resize items-center justify-center"
            )}
          >
            <span className="h-0.5 w-8 rounded-full bg-border/0 transition-colors group-hover:bg-foreground/50" />
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Intelligence width"
            title="Drag to resize width"
            onPointerDown={handleWidthResize}
            className="group absolute right-0 top-0 z-10 flex h-full w-1.5 cursor-ew-resize items-center justify-center"
          >
            <span className="h-8 w-0.5 rounded-full bg-border/0 transition-colors group-hover:bg-foreground/50" />
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Intelligence size"
            title="Drag to resize"
            onPointerDown={handleCornerResize}
            className="absolute bottom-0 right-0 z-20 size-3 cursor-nwse-resize"
          />
        </>
      )}

      <div
        className="h-1 w-full shrink-0"
        style={{ backgroundColor: panelAccent }}
        aria-hidden
      />

      <header
        data-floating-title
        data-window-id="chat"
        onPointerDown={isPhone || isMaximized ? undefined : handleDrag}
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 border-b px-2 data-[tile-swap-target=true]:ring-2 data-[tile-swap-target=true]:ring-ring",
          !isPhone && !isMaximized && "cursor-move"
        )}
        style={{
          borderColor: `${panelAccent}40`,
          backgroundColor: `${panelAccent}14`,
        }}
      >
        {isDmMode ? (
          <MessageCircleIcon className="size-4" style={{ color: panelAccent }} />
        ) : isPersonaAgent(activeAgentId) ? (
          <DigitalYouIcon className="size-4" />
        ) : (
          <BotIcon className="size-4" style={{ color: panelAccent }} />
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <ChatTargetSearch titleMode />
            {isDmMode && (
              <span className="shrink-0 rounded bg-primary/10 px-1 text-[9px] font-medium uppercase tracking-wide text-primary">
                {activeConversation?.kind === "group" ? "Group" : "DM"}
              </span>
            )}
          </div>
          {isDmMode && (
            <p className="truncate text-[10px] leading-none text-muted-foreground">
              {dmSubtitle}
            </p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Chat history"
              >
                <ClockIcon className="size-3.5" />
                History
                <ChevronDownIcon className="size-3" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Agent chats</DropdownMenuLabel>
            {chats.length === 0 && (
              <DropdownMenuItem disabled>No saved chats</DropdownMenuItem>
            )}
            {chats.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => {
                  setChatTarget({ kind: "agent", agentId: activeAgentId });
                  void loadChat(c.id);
                }}
                className="group/chat"
              >
                <span className="truncate">{c.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteChat(c.id);
                  }}
                  className="ml-auto opacity-0 transition-opacity group-hover/chat:opacity-100"
                >
                  <Trash2Icon className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </DropdownMenuItem>
            ))}
            {dmConversations.length > 0 && (
              <>
                <DropdownMenuLabel>Conversations</DropdownMenuLabel>
                {dmConversations.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() =>
                      setChatTarget({ kind: "conversation", conversationId: c.id })
                    }
                  >
                    <span className="truncate">{c.displayTitle}</span>
                    {c.unreadCount > 0 ? (
                      <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                        {c.unreadCount}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(lockCreate && "godmode-chrome-entice")}
            aria-label="New chat"
            title={
              lockCreate
                ? "Unlock create chat (tutorial or pay to skip)"
                : "New chat"
            }
            onClick={() => {
              if (lockCreate) {
                onLockedCreate?.();
                return;
              }
              newChat();
            }}
          >
            <PlusIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => setPanelMinimized(true)}
          >
            <MinusIcon />
          </Button>
          {!isPhone && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(lockResize && "godmode-chrome-entice")}
              aria-label={isMaximized ? "Restore" : "Maximize"}
              title={
                lockResize
                  ? "Unlock window controls (tutorial or pay to skip)"
                  : isMaximized
                    ? "Restore"
                    : "Maximize"
              }
              onClick={() => {
                if (lockResize) {
                  onLockedResize?.();
                  return;
                }
                setPanelMaximized(!isMaximized);
              }}
            >
              {isMaximized ? <Minimize2Icon /> : <Maximize2Icon />}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(lockClose && "godmode-chrome-entice")}
            aria-label="Close"
            title={
              lockClose
                ? "Unlock close (tutorial or pay to skip)"
                : "Close (Ctrl/Cmd+L)"
            }
            onClick={() => {
              if (lockClose) {
                onLockedClose?.();
                return;
              }
              setPanelOpen(false);
            }}
          >
            <XIcon />
          </Button>
        </div>
      </header>

      <ChatWindowTabs tab={effectiveTab} onTabChange={setPanelTab} />

      <PanelErrorBoundary resetKey={effectiveTab}>
        {effectiveTab === "chat" && (
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {showChatDirectory && isPhone && directoryOpen ? (
              <button
                type="button"
                className="absolute inset-0 z-10 bg-background/40"
                aria-label="Hide conversations"
                onClick={() => setDirectoryOpen(false)}
              />
            ) : null}
            {showChatDirectory ? (
              <ChatDirectorySidebar
                agentId={activeAgentId}
                agentName={agentName}
                chatTarget={chatTarget}
                conversations={dmConversations}
                className={cn(
                  isPhone && !directoryOpen && "hidden",
                  isPhone &&
                    directoryOpen &&
                    "absolute inset-y-0 left-0 z-20 w-64 shadow-md"
                )}
                onSelectAgent={() => {
                  setChatTarget({ kind: "agent", agentId: activeAgentId });
                  setDirectoryOpen(false);
                }}
                onSelectConversation={(id) => {
                  setChatTarget({ kind: "conversation", conversationId: id });
                  setDirectoryOpen(false);
                }}
                onCreated={() => void refreshDmConversations()}
              />
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {showChatDirectory && isPhone ? (
                <div className="flex shrink-0 items-center border-b px-2 py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Show conversations"
                    aria-expanded={directoryOpen}
                    onClick={() => setDirectoryOpen((open) => !open)}
                  >
                    <PanelLeftIcon data-icon="inline-start" />
                    Conversations
                  </Button>
                </div>
              ) : null}
        {effectiveTab === "chat" && !isDmMode && agentShared && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <BotIcon className="size-3 text-amber-400" />
              Shared agent. Chats save to{" "}
              <span className="font-medium text-foreground">your project</span>
            </span>
            <label
              className="ml-auto inline-flex cursor-pointer items-center gap-1.5 select-none"
              title="Also save new memories from this chat to the agent owner's project"
            >
              <input
                type="checkbox"
                className="size-3 accent-amber-500"
                checked={contributeMemory}
                onChange={(e) => setContributeMemory(e.target.checked)}
              />
              Contribute memory back
            </label>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={sharingSession || sharedSession || !activeChatId}
              onClick={handleShareSession}
              title={
                sharedSession
                  ? "This conversation is a live shared session"
                  : "Start a shared session so collaborators can join live"
              }
            >
              {sharedSession ? (
                <>
                  <UsersIcon className="size-3" /> Shared session
                </>
              ) : (
                <>
                  <Share2Icon className="size-3" /> Share conversation
                </>
              )}
            </Button>
          </div>
        )}
        {effectiveTab === "chat" && !isDmMode && (
          <ActiveWorkPanel
            agentId={activeAgentId}
            chatId={activeChatId}
            onOpenBoard={() => setPanelTab("projects")}
          />
        )}
        {effectiveTab === "chat" && (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        >
          {messages.length === 0 && !isDmMode && activeAgentId === "intelligence" && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-8 text-center">
              <BotIcon className="size-32 text-foreground/70" />
              <div className="flex flex-col items-center gap-2 text-2xl text-foreground">
                <p>{INTELLIGENCE_GREETING_HELLO}</p>
                <p>{INTELLIGENCE_GREETING_QUESTION}</p>
              </div>
              <div className="grid w-full max-w-5xl grid-cols-4 gap-4">
                {INTELLIGENCE_INTERESTS.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-12 text-base"
                    disabled={busy}
                    onClick={() => startInterestTour(item.id)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.length === 0 && (isDmMode || activeAgentId !== "intelligence") && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              {isDmMode ? (
                <BrainIcon className="size-8 text-foreground/70" />
              ) : isPersonaAgent(activeAgentId) ? (
                <DigitalYouIcon className="size-12" />
              ) : (
                <BotIcon className="size-8 text-foreground/70" />
              )}
              <p className="text-sm font-medium text-foreground">
                {isDmMode ? dmTitle : agentName}
              </p>
            </div>
          )}

          {messages.map((m) => {
            const own = m.isOwn ?? m.role === "user";
            const deferTourReply = !own && m.id === tourReplyId;
            const visibleParts = deferTourReply
              ? (m.parts ?? []).filter((part) => part.kind !== "text")
              : m.parts;
            if (deferTourReply && visibleParts.length === 0) return null;
            if (own) {
              return (
                <div key={m.id} className="group flex flex-col items-end gap-0.5">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-muted px-3 py-2 text-sm">
                    {m.images && m.images.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {m.images.map((img, i) => (
                          <img
                            key={i}
                            src={img}
                            alt="attachment"
                            className="size-16 rounded-md border border-border/60 object-cover"
                          />
                        ))}
                      </div>
                    )}
                    <span className="whitespace-pre-wrap">{m.text}</span>
                  </div>
                  {!isDmMode && (
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => copyMessage(m.text)}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setSeedText(m.text);
                          void handleDeleteMessage(m.id);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div key={m.id} className="group flex flex-col max-w-[90%] gap-0.5">
                {m.dmSenderName && (
                  <span className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                    {m.dmSenderKind === "agent" ? "🤖 " : ""}
                    {m.dmSenderName}
                  </span>
                )}
                {(() => {
                  const hasParts = !isDmMode && visibleParts && visibleParts.length > 0;
                  const showWorking =
                    m.streaming && !hasParts && !m.text;
                  if (showWorking) {
                    return (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="flex gap-0.5">
                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                          </span>
                          {m.statusText?.trim() || "Working…"}
                        </span>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={stop}
                        >
                          Stop
                        </Button>
                      </div>
                    );
                  }
                  if (hasParts) {
                    return (
                      <ChatTurn
                        parts={visibleParts!}
                        kanbanTodoCards={kanbanTodoCards}
                        onApproveTool={handleApproveTool}
                        onDenyTool={handleDenyTool}
                      />
                    );
                  }
                  if (deferTourReply) return null;
                  if (m.dmSenderKind === "agent" || !isDmMode) {
                    return <Markdown content={m.text} artifactLinks />;
                  }
                  return (
                    <div className="rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap">
                      {m.text}
                    </div>
                  );
                })()}
                {!isDmMode && !m.streaming && !deferTourReply && (
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        copyMessage(
                          m.parts?.length
                            ? m.parts
                                .filter((p) => p.kind === "text")
                                .map((p) => (p as { text: string }).text)
                                .join("\n") || m.text
                            : m.text
                        )
                      }
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => void handleRegenerate(m.id)}
                    >
                      Regenerate
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => void handleDeleteMessage(m.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {tourLines.map((line, index) => (
            <div
              key={`${line.label}-${index}`}
              className="flex max-w-[85%] flex-col gap-1 rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-sm text-foreground"
            >
              <p className="font-medium">{line.label}</p>
              <p>{line.say}</p>
            </div>
          ))}
          {tourReplyId && !holdTourReply && (() => {
            const reply = messages.find((row) => row.id === tourReplyId);
            const text = reply
              ? reply.parts?.length
                ? partsAnswerText(reply.parts)
                : reply.text.trim()
              : "";
            if (!reply || !text) return null;
            return (
              <div key={`${reply.id}-after-tour`} className="group flex max-w-[90%] flex-col gap-0.5">
                <Markdown content={text} artifactLinks />
                {!isDmMode && !reply.streaming && (
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => copyMessage(text)}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => void handleRegenerate(reply.id)}
                    >
                      Regenerate
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => void handleDeleteMessage(reply.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          {guideChoice && !holdTourReply && (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-base font-medium text-foreground">
                {guideChoice.question}
              </p>
              {guideChoice.why ? (
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {guideChoice.why}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {choiceOptionsForUserAgent(
                  guideChoice.options,
                  typeof navigator === "undefined" ? "" : navigator.userAgent
                ).map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setGuideChoice(null);
                      if (option.id === "cloud") {
                        startCloudGuide(option.label);
                        return;
                      }
                      void send({
                        text: option.label,
                        images: [],
                        mentionIds: [],
                        pathId: option.id,
                      });
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
            </div>
          </div>
        )}

{effectiveTab === "notifications" && (
            <div className="min-h-0 flex-1 overflow-hidden px-3 py-2">
              <NotificationsList compact />
            </div>
          )}

          {effectiveTab === "calendar" && (
            <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
              <CalendarBoard
                scope={
                  userTooling
                    ? { kind: "user" }
                    : { kind: "agent", agentId: activeAgentId }
                }
              />
            </div>
          )}

        {effectiveTab === "projects" && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <AutomationsPanel
              agentId={userTooling ? undefined : activeAgentId}
              userOwned={userTooling}
              showTasks
              showEvents
            />
          </div>
        )}

        {effectiveTab === "knowledge" && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <KnowledgePanel />
          </div>
        )}

        {effectiveTab === "bank" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <Bank embedded agentId={userTooling ? null : activeAgentId} />
          </div>
        )}

        {effectiveTab === "vault" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {userTooling ? (
              <Vault mode="user" embedded />
            ) : (
              <Vault mode="agent" agentId={activeAgentId} embedded />
            )}
          </div>
        )}

        {effectiveTab === "support" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <Support />
          </div>
        )}

        {effectiveTab === "chat" && errorMsg && (
          <div className="flex items-center gap-2 border-t border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <span className="min-w-0 flex-1">{errorMsg}</span>
            {errorCode === "CURSOR_SESSION_STALE" && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => {
                  void (async () => {
                    try {
                      await refreshCursorSession(activeAgentId);
                      toast.success("Cursor session refreshed. Retry your message.");
                      setErrorMsg(null);
                      setErrorCode(null);
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Could not refresh Cursor session"
                      );
                    }
                  })();
                }}
              >
                Refresh session
              </Button>
            )}
          </div>
        )}
      </PanelErrorBoundary>

      <footer className="flex h-7 shrink-0 items-center justify-between gap-2 border-t px-2 text-[10px] text-muted-foreground">
        {isDmMode ? (
          <>
            <span>
              {activeConversation?.kind === "group"
                ? "Group conversation"
                : "Direct message"}
            </span>
            {dmMemberSummary && (
              <span className="truncate pl-3">{dmMemberSummary}</span>
            )}
          </>
        ) : (
          <>
            {authenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex max-w-[55%] items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Model"
                  >
                    <span
                      className={cn("size-1.5 shrink-0 rounded-full", modelDotClass)}
                    />
                    <span className="truncate">{modelLabel}</span>
                    <ChevronDownIcon className="size-3 shrink-0" />
                  </button>
                }
              />
              <DropdownMenuContent
                align="start"
                className="max-h-80 w-72 overflow-y-auto"
              >
                <DropdownMenuLabel>Local models</DropdownMenuLabel>
                {catalogBySource.local.length === 0 && (
                  <DropdownMenuItem disabled>
                    No local GGUF models found
                  </DropdownMenuItem>
                )}
                {catalogBySource.local.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() => void handleCatalogSelect(m)}
                  >
                    <span className="truncate">{m.label}</span>
                    {m.multimodal && (
                      <ImageIcon className="ml-auto size-3 text-muted-foreground" />
                    )}
                    {m.active && (
                      <span className="ml-1 text-xs text-emerald-500">●</span>
                    )}
                  </DropdownMenuItem>
                ))}
                {authenticated && catalogBySource.cursor.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Cursor</DropdownMenuLabel>
                    {catalogBySource.cursor.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => void handleCatalogSelect(m)}
                      >
                        <FileCodeIcon className="size-3 shrink-0 text-sky-500" />
                        <span className="truncate">{m.label}</span>
                        {m.active && (
                          <span className="ml-1 text-xs text-sky-500">●</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {catalogGodModeInference.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>GodMode Inference</DropdownMenuLabel>
                    {catalogGodModeInference.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => void handleCatalogSelect(m)}
                      >
                        <span className="truncate">{m.label}</span>
                        {m.active && (
                          <span className="ml-1 text-xs text-sky-500">●</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {authenticated && catalogVaultProviders.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>
                      Cloud API (Platform Vault keys)
                    </DropdownMenuLabel>
                    {catalogVaultProviders.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => void handleCatalogSelect(m)}
                      >
                        <span className="truncate">{m.label}</span>
                        {m.active && (
                          <span className="ml-1 text-xs text-sky-500">●</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {catalogBySource.remote.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Shared with me</DropdownMenuLabel>
                    {catalogBySource.remote.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={() => void handleCatalogSelect(m)}
                      >
                        <span className="truncate">{m.label}</span>
                        {m.active && (
                          <span className="ml-1 text-xs text-sky-500">●</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-[11px]">
                  Add cloud keys in Platform Vault · manage in Builder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            ) : (
              <span
                className="inline-flex max-w-[55%] items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                title="Model"
              >
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", modelDotClass)}
                />
                <span className="truncate">{modelLabel}</span>
              </span>
            )}
            <span className="inline-flex shrink-0 items-center gap-1.5">
              {status?.tokensPerSecond != null && running && (
                <span className="tabular-nums">
                  {status.tokensPerSecond.toFixed(1)} t/s
                </span>
              )}
              <span className="relative size-3">
                <svg viewBox="0 0 36 36" className="size-3 -rotate-90">
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.2"
                    strokeWidth="6"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="6"
                    strokeDasharray={`${(contextPct / 100) * 94.2} 94.2`}
                  />
                </svg>
              </span>
              {contextPct}% context
              {queuePending > 0 && (
                <span className="ml-2 text-amber-500">queue {queuePending}</span>
              )}
            </span>
          </>
        )}
      </footer>

      <ArtifactViewerDialog />
    </aside>
  );
}
