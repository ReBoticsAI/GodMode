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
  ChevronDownIcon,
  ClockIcon,
  Maximize2Icon,
  MessageCircleIcon,
  Minimize2Icon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  clampComposerWidth,
  clampPanelHeight,
  useIntelligence,
  type PanelTab,
} from "@/lib/intelligence-context";
import { AI_NAME } from "@/lib/navigation";
import { useAiStatus } from "@/hooks/use-ai-status";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAgentMentionSources } from "@/hooks/use-agent-mention-sources";
import { useKanbanTodosForChat } from "@/hooks/use-kanban-todos-for-chat";
import {
  createAiMemory,
  deleteAiChat,
  fetchAiAgent,
  fetchAiChats,
  fetchAiMessages,
  fetchAiQueue,
  fetchChatSession,
  startSharedChatSession,
  confirmAiTool,
  streamAiChat,
  truncateAiChat,
  deleteAiChatMessage,
  fetchAiArtifact,
  fetchDmContacts,
  fetchDmMessages,
  getActiveTenantId,
  markDmConversationRead,
  sendDmMessage,
  type AiChat,
  type DmContact,
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
import { ConversationList } from "@/components/messages/ConversationList";
import { ChatTargetSearch } from "./ChatTargetSearch";
import { ActiveWorkPanel } from "./projects/ActiveWorkPanel";
import { Markdown } from "./Markdown";
import { ArtifactViewerDialog, artifactViewerHref } from "./ArtifactViewerDialog";
import { ChatTurn } from "./ChatTurn";
import {
  PartsBuilder,
  estimateTokens,
  partsToPlainText,
  partsAnswerText,
  type MsgPart,
} from "./chat-parts";
import { IntelligenceComposer, type ComposerSubmit } from "./IntelligenceComposer";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: string[];
  thinking?: string | null;
  /** Structured Cursor-style parts for assistant turns (tools/thinking/todos/text). */
  parts?: MsgPart[];
  streaming?: boolean;
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

export function IntelligencePanel() {
  const {
    panelOpen,
    setPanelOpen,
    seedText,
    setSeedText,
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
  } = useIntelligence();
  const { user } = useTenant();
  const { status } = useAiStatus();
  const isMobile = useIsMobile();
  const isDmMode = chatTarget.kind === "conversation";
  const allowedTabs: PanelTab[] = isDmMode
    ? ["chat", "dms", "channels"]
    : ["chat", "notifications", "calendar", "projects", "knowledge", "bank", "vault", "support"];
  const effectiveTab: PanelTab = allowedTabs.includes(panelTab)
    ? panelTab
    : "chat";
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
  const [chats, setChats] = useState<AiChat[]>([]);
  const [dmContacts, setDmContacts] = useState<DmContact[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const kanbanTodoCards = useKanbanTodosForChat(
    activeAgentId,
    activeChatId,
    !isDmMode && effectiveTab === "chat"
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // "Engine vs Work" UI state: whether the active agent is shared TO the user
  // (so chats save to THEIR workspace), the opt-in to contribute new memories
  // back to the agent owner, and whether this conversation is a shared session.
  const [agentShared, setAgentShared] = useState(false);
  const [agentName, setAgentName] = useState<string>(AI_NAME);
  const [agentDescription, setAgentDescription] = useState<string | null>(null);
  const [contributeMemory, setContributeMemory] = useState(false);
  const [sharedSession, setSharedSession] = useState(false);
  const [sharingSession, setSharingSession] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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

  // viewport changes.
  useEffect(() => {
    const recompute = () => {
      const nextBounds = getPanelBounds();
      setBounds(nextBounds);
      const width = clampComposerWidth(composerWidth, nextBounds.width);
      const height = clampPanelHeight(panelHeight, nextBounds.height);
      setComposerWidth(width);
      setPanelHeight(height);
      const defaultX = nextBounds.x + 12;
      const defaultY = nextBounds.y + nextBounds.height - height - 12;
      const pos = clampPanelPos(
        panelX ?? defaultX,
        panelY ?? defaultY,
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

  const handleDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const target = e.target;
    if (target instanceof Element && target.closest("button,[role='button']")) {
      return;
    }
    e.preventDefault();
    const activeBounds = getPanelBounds();
    setBounds(activeBounds);
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanelX = panelX ?? activeBounds.x + 12;
    const startPanelY =
      panelY ?? activeBounds.y + activeBounds.height - panelHeight - 12;
    const onMove = (ev: PointerEvent) => {
      const pos = clampPanelPos(
        startPanelX + ev.clientX - startX,
        startPanelY + ev.clientY - startY,
        composerWidth,
        panelHeight,
        activeBounds
      );
      setPanelPos(pos.x, pos.y);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
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
    const currentX = panelX ?? activeBounds.x + 12;
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
    const currentX = panelX ?? activeBounds.x + 12;
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

  useEffect(() => {
    if (!isDmMode) return;
    fetchDmContacts()
      .then((r) => setDmContacts(r.contacts))
      .catch(() => undefined);
  }, [isDmMode]);

  const directConversations = dmConversations.filter(
    (c) =>
      c.kind === "direct" &&
      !c.members.some((m) => m.memberKind === "agent")
  );
  const groupConversations = dmConversations.filter(
    (c) => c.kind === "group" || c.members.length > 2
  );

  // Resolve whether the active agent is shared TO this user. When owned,
  // engine === work, so the ownership UI stays hidden and behavior is unchanged.
  useEffect(() => {
    let cancelled = false;
    if (!activeAgentId) {
      setAgentShared(false);
      setAgentName(AI_NAME);
      setAgentDescription(null);
      return;
    }
    fetchAiAgent(activeAgentId)
      .then((a) => {
        if (cancelled) return;
        setAgentShared(Boolean(a.shared));
        setAgentName(
          a.id === "intelligence" ? AI_NAME : a.name?.trim() || AI_NAME
        );
        setAgentDescription(a.description?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) {
          setAgentShared(false);
          setAgentName(AI_NAME);
          setAgentDescription(null);
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
      toast.success("Conversation shared — collaborators can now join live.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to share conversation");
    } finally {
      setSharingSession(false);
    }
  }, [activeChatId, activeAgentId]);

  // Seed text from any launcher into the composer.
  useEffect(() => {
    if (seedText) {
      setInput(seedText);
      setSeedText("");
    }
  }, [seedText, setSeedText]);

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
      }
    },
    []
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
  }, [messages]);

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
    setInput(priorUser.text);
    void send({ text: priorUser.text, images: priorUser.images ?? [], mentionIds: [] });
  };

  const send = async ({ text, images, mentionIds, dmAttachments }: ComposerSubmit) => {
    if (busy) return;
    setErrorMsg(null);

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
      { id: assistantId, role: "assistant", text: "", parts: [], streaming: true },
    ]);
    setBusy(true);

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
      },
      {
        onChatId: (chatId) => {
          if (!activeChatId) setActiveChatId(chatId);
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
          sync();
        },
        onTerminalOutput: ({ toolCallId, stream, text }) => {
          builder.onTerminalOutput(toolCallId, stream, text);
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
                  }
                : m
            )
          );
          setBusy(false);
          abortRef.current = null;
          refreshChats();
        },
        onError: (error) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    parts: [
                      ...builder.finalize(),
                      { kind: "text", text: `⚠️ ${error}` },
                    ],
                    text: `⚠️ ${error}`,
                    streaming: false,
                  }
                : m
            )
          );
          setErrorMsg(error);
          setBusy(false);
          abortRef.current = null;
        },
        onToolConfirmRequired: (payload) => {
          builder.onToolConfirmRequired(payload.toolCallId);
          pendingConfirmRef.current = builder;
          pendingAssistantIdRef.current = assistantId;
          sync();
          if (toolAutonomy === "full") {
            void confirmAiTool(payload.toolCallId, true);
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
    void confirmAiTool(toolCallId, approved);
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
  const currentWidth = clampComposerWidth(composerWidth, bounds.width);
  const currentHeight = clampPanelHeight(panelHeight, bounds.height);
  const defaultX = bounds.x + 12;
  const defaultY = bounds.y + bounds.height - currentHeight - 12;
  const pos = clampPanelPos(
    panelX ?? defaultX,
    panelY ?? defaultY,
    currentWidth,
    currentHeight,
    bounds
  );

  if (!panelOpen) return null;

  return (
    <aside
      ref={asideRef}
      style={
        isMobile
          ? undefined
          : isMaximized
            ? {
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
                maxWidth: bounds.width,
                maxHeight: bounds.height,
              }
            : {
                left: pos.x,
                top: pos.y,
                width: currentWidth,
                height: currentHeight,
                maxWidth: bounds.width,
                maxHeight: bounds.height,
              }
      }
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-popover",
        isMobile
          ? "fixed inset-0 z-50"
          : "absolute z-40 rounded-xl border shadow-2xl"
      )}
    >
      {!isMobile && !isMaximized && (
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

      <header
        onPointerDown={isMobile || isMaximized ? undefined : handleDrag}
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 border-b px-2",
          !isMobile && !isMaximized && "cursor-move"
        )}
      >
        {isDmMode ? (
          <MessageCircleIcon className="size-4 text-primary" />
        ) : (
          <BotIcon className="size-4 text-foreground" />
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
            aria-label="New chat"
            title="New chat"
            onClick={newChat}
          >
            <PlusIcon />
          </Button>
          {!isMobile && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={isMaximized ? "Restore" : "Maximize"}
              title={isMaximized ? "Restore" : "Maximize"}
              onClick={() => setPanelMaximized(!isMaximized)}
            >
              {isMaximized ? <Minimize2Icon /> : <Maximize2Icon />}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Close"
            title="Close (Ctrl/Cmd+L)"
            onClick={() => setPanelOpen(false)}
          >
            <XIcon />
          </Button>
        </div>
      </header>

      <Tabs value={effectiveTab} onValueChange={(v) => setPanelTab(v as PanelTab)} className="shrink-0 px-2 pt-1">
        <TabsList variant="line" className="h-8 w-full justify-start">
          <TabsTrigger value="chat" className="text-xs">Chat</TabsTrigger>
          {isDmMode ? (
            <>
              <TabsTrigger value="dms" className="text-xs">DMs</TabsTrigger>
              <TabsTrigger value="channels" className="text-xs">Channels</TabsTrigger>
            </>
    ) : (
      <>
        <TabsTrigger value="notifications" className="text-xs">Notifications</TabsTrigger>
        <TabsTrigger value="calendar" className="text-xs">Calendar</TabsTrigger>
        {/* Internal id remains "projects" for stored panel tab preference. */}
        <TabsTrigger value="projects" className="text-xs">Automations</TabsTrigger>
        <TabsTrigger value="knowledge" className="text-xs">Knowledge</TabsTrigger>
        <TabsTrigger value="bank" className="text-xs">Bank</TabsTrigger>
        <TabsTrigger value="vault" className="text-xs">Vault</TabsTrigger>
        <TabsTrigger value="support" className="text-xs">Support</TabsTrigger>
      </>
    )}
        </TabsList>
      </Tabs>

      <PanelErrorBoundary resetKey={effectiveTab}>
        {effectiveTab === "chat" && !isDmMode && agentShared && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <BotIcon className="size-3 text-amber-400" />
              Shared agent — chats save to{" "}
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
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              {isDmMode ? (
                <MessageCircleIcon className="size-8 text-primary/70" />
              ) : (
                <BotIcon className="size-8 text-foreground/70" />
              )}
              <p className="text-sm font-medium text-foreground">
                {isDmMode ? `Message ${dmTitle}` : `Ask ${agentName}`}
              </p>
              {!isDmMode && activeAgentId === "intelligence" ? (
                <div className="max-w-[340px] space-y-3 text-left text-xs leading-relaxed">
                  <p className="text-muted-foreground">
                    {agentDescription ||
                      "Intelligence is GodMode's built-in AI — your guide to the platform itself."}
                  </p>
                  <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
                    <li>Explain how GodMode works and help you get oriented</li>
                    <li>Create departments, pages, agents, wiki articles, and tasks</li>
                    <li>Wire automations and configure your workspace from chat</li>
                    <li>Hand off focused work to specialized subagents when you are ready</li>
                  </ul>
                </div>
              ) : (
                <p className="max-w-[320px] whitespace-pre-line text-xs leading-relaxed">
                  {isDmMode
                    ? "This conversation uses direct messages, including any agent members in the thread."
                    : agentDescription ||
                      `${agentName} is your AI agent. Start a conversation to put it to work.`}
                </p>
              )}
              {!isDmMode && !running && (
                <p className="mt-2 max-w-[260px] rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600">
                  No model running. Start one from the Agents page or the model
                  picker below.
                </p>
              )}
            </div>
          )}

          {messages.map((m) => {
            const own = m.isOwn ?? m.role === "user";
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
                          setInput(m.text);
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
                  const hasParts = !isDmMode && m.parts && m.parts.length > 0;
                  const showWorking =
                    m.streaming && !hasParts && !m.text;
                  if (showWorking) {
                    return (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="flex gap-0.5">
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                        </span>
                        Working…
                      </div>
                    );
                  }
                  if (hasParts) {
                    return (
                      <ChatTurn
                        parts={m.parts!}
                        kanbanTodoCards={kanbanTodoCards}
                        onApproveTool={handleApproveTool}
                        onDenyTool={handleDenyTool}
                      />
                    );
                  }
                  if (m.dmSenderKind === "agent" || !isDmMode) {
                    return <Markdown content={m.text} artifactLinks />;
                  }
                  return (
                    <div className="rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap">
                      {m.text}
                    </div>
                  );
                })()}
                {!isDmMode && !m.streaming && (
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
        </div>
        )}

{effectiveTab === "notifications" && (
            <div className="min-h-0 flex-1 overflow-hidden px-3 py-2">
              <NotificationsList compact />
            </div>
          )}

          {effectiveTab === "calendar" && (
            <div className="min-h-0 flex-1 overflow-hidden px-2 py-2">
              <CalendarBoard scope={{ kind: "agent", agentId: activeAgentId }} />
            </div>
          )}

        {effectiveTab === "projects" && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <AutomationsPanel
              agentId={activeAgentId}
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
            <Bank />
          </div>
        )}

        {effectiveTab === "vault" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <Vault />
          </div>
        )}

        {effectiveTab === "support" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <Support />
          </div>
        )}

        {effectiveTab === "dms" && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ConversationList
              conversations={directConversations}
              contacts={dmContacts}
              activeId={activeConversationId}
              onSelect={(id) =>
                setChatTarget({ kind: "conversation", conversationId: id })
              }
              onCreated={() => void refreshDmConversations()}
            />
          </div>
        )}

        {effectiveTab === "channels" && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <ConversationList
              conversations={groupConversations}
              contacts={dmContacts}
              activeId={activeConversationId}
              onSelect={(id) =>
                setChatTarget({ kind: "conversation", conversationId: id })
              }
              onCreated={() => void refreshDmConversations()}
            />
          </div>
        )}

        {effectiveTab === "chat" && errorMsg && (
          <div className="border-t border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {errorMsg}
          </div>
        )}

        <div className="shrink-0 px-3 pb-2">
          <IntelligenceComposer
            variant="panel"
            value={input}
            onChange={setInput}
            onSubmit={send}
            busy={busy}
            onStop={stop}
            dmMode={isDmMode}
            onNewChat={newChat}
            onOpenRules={() => openPanel({ tab: "knowledge", knowledgeSubTab: "rules" })}
            onMemoryAdd={async (text) => {
              await createAiMemory({ text, agentId: activeAgentId, scope: "global" });
              toast("Memory saved");
            }}
            placeholder={
              isDmMode
                ? `Message ${dmTitle}…  (Enter to send, Shift+Enter for newline)`
                : `Ask ${agentName} anything…  (Enter to send, Shift+Enter for newline)`
            }
          />
        </div>
      </PanelErrorBoundary>

      <footer className="flex h-6 shrink-0 items-center justify-between border-t px-3 text-[10px] text-muted-foreground">
        {isDmMode ? (
          <>
            <span>{activeConversation?.kind === "group" ? "Group conversation" : "Direct message"}</span>
            {dmMemberSummary && (
              <span className="truncate pl-3">{dmMemberSummary}</span>
            )}
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  running ? "bg-emerald-500" : "bg-muted-foreground/60"
                )}
              />
              Local
              {status?.tokensPerSecond != null && running && (
                <span className="ml-1 tabular-nums">
                  {status.tokensPerSecond.toFixed(1)} t/s
                </span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
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
