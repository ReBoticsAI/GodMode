import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import {
  createDmConversation,
  fetchDmConversations,
  fetchDmUnread,
  fetchNotificationUnreadCount,
  type DmConversation,
  type DmMessage,
} from "@/api";
import {
  chromelessHeaderSegments,
  departmentFromPath,
  divisionFromPath,
  isChromelessPath,
  type DepartmentNode,
} from "./navigation";
import { useStructure } from "./structure-context";
import { useTenant } from "./tenant-context";
import {
  ACTIVE_AGENT_KEY,
  AGENTS_SECTION_KEY,
  AUTO_ACCEPT_TOOLS_KEY,
  CHAT_MODE_KEY,
  TOOL_AUTONOMY_KEY,
  COMPOSER_WIDTH_KEY,
  LEGACY_ACTIVE_AGENT_KEY,
  LEGACY_AGENTS_MODE_KEY_OLD,
  LEGACY_AGENTS_SECTION_KEY,
  LEGACY_COMPOSER_WIDTH_KEY,
  LEGACY_PANEL_HEIGHT_KEY,
  LEGACY_PANEL_TAB_KEY,
  LEGACY_PANEL_X_KEY,
  LEGACY_PANEL_Y_KEY,
  PANEL_HEIGHT_KEY,
  PANEL_TAB_KEY,
  PANEL_X_KEY,
  PANEL_Y_KEY,
  readMigratedKey,
  readStorageKey,
  readTenantId,
  writeMigratedKey,
  writeStorageKey,
} from "./storage-keys";

export interface PageContextSnapshot {
  /** Stable key for the publishing page, e.g. "trading-plan". */
  kind: string;
  /** Short human label shown in the context chip. */
  label?: string;
  /** Arbitrary structured data the model should treat as ground truth. */
  data: unknown;
}

export interface MentionSource {
  id: string;
  label: string;
  /** Group label for the Add context menu and @ autocomplete. */
  category?: string;
  /** Lazily resolve the data so we don't serialize until mentioned. */
  resolve: () => unknown | Promise<unknown>;
}

export type IntelligenceChatMode = "agent" | "plan" | "ask";
export type ToolAutonomyLevel = "off" | "writes" | "full";

export interface PlatformContextPayload {
  breadcrumb: string[];
  pathname: string;
  pageKind?: string;
  pageLabel?: string;
  pageSnapshot?: unknown;
  mentionedSources?: Array<{ id: string; label: string; data: unknown }>;
}

/** What the unified chat window is talking to. */
export type ChatTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "conversation"; conversationId: string };

interface IntelligenceContextValue {
  breadcrumb: string[];
  pathname: string;
  pageSnapshot: PageContextSnapshot | null;
  setPageSnapshot: (snap: PageContextSnapshot | null) => void;
  mentionSources: MentionSource[];
  registerMentionSource: (src: MentionSource) => () => void;
  buildPlatformContext: (
    mentionIds: string[]
  ) => Promise<PlatformContextPayload>;
  captureScreenshot: () => Promise<string | null>;
  /** Panel UI state shared between the footer launcher and the docked panel. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  /** Whether the docked panel is maximized to fill the content area. */
  panelMaximized: boolean;
  setPanelMaximized: (v: boolean) => void;
  /** Open the panel, optionally jumping to a tab, agent, conversation, and/or maximizing it. */
  openPanel: (opts?: {
    tab?: PanelTab;
    agentId?: string;
    conversationId?: string;
    contactUserId?: string;
    maximized?: boolean;
    prompt?: string;
    autoSend?: boolean;
    knowledgeSubTab?: KnowledgeSubTab;
    artifactId?: string;
    artifactName?: string;
  }) => void;
  /** Unified chat target: agent-only (ai_chats) or a dm/group conversation. */
  chatTarget: ChatTarget;
  setChatTarget: (target: ChatTarget) => void;
  /** DM conversations for the target selector + history. */
  dmConversations: DmConversation[];
  refreshDmConversations: () => Promise<void>;
  dmUnreadCount: number;
  onDmIncomingMessage: (
    cb: (msg: DmMessage, conversationId: string) => void
  ) => () => void;
  /** Unread notification count for the current user (sidebar + tab badge). */
  notificationsUnread: number;
  refreshNotificationsUnread: () => Promise<void>;
  /** Text seeded from the footer composer to prefill the in-panel composer. */
  seedText: string;
  setSeedText: (text: string) => void;
  /** When set, Intelligence chat auto-sends this prompt on the next open. */
  autoSendPrompt: string | null;
  setAutoSendPrompt: (text: string | null) => void;
  /** When set, the panel should load this chat id. */
  pendingChatId: string | null;
  setPendingChatId: (id: string | null) => void;
  /** Width (px) of the floating modal. */
  composerWidth: number;
  setComposerWidth: (width: number) => void;
  /** Height (px) of the floating modal. */
  panelHeight: number;
  setPanelHeight: (height: number) => void;
  /** Top-left position (px, relative to the content area) of the floating
   * modal. `null` means "not placed yet" → the panel picks a default. */
  panelX: number | null;
  panelY: number | null;
  setPanelPos: (x: number, y: number) => void;
  /** Active tab in the floating panel content area. */
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  /** Section within the Agents workspace. */
  agentsSection: AgentsSection;
  setAgentsSection: (section: AgentsSection) => void;
  /** Subagent used for the next chat turn (defaults to intelligence). */
  activeAgentId: string;
  setActiveAgentId: (id: string) => void;
  /** Count of autonomous runs awaiting review (drives the Projects tab badge). */
  reviewUnread: number;
  bumpReviewUnread: () => void;
  clearReviewUnread: () => void;
  /** Sub-tab within Knowledge (Rules, Skills, Memory, Artifacts, Reflection). */
  knowledgeSubTab: KnowledgeSubTab;
  setKnowledgeSubTab: (tab: KnowledgeSubTab) => void;
  /** Currently open artifact in the full-screen viewer (null = closed). */
  artifactViewer: { id: string; name?: string } | null;
  openArtifactViewer: (opts: { id: string; name?: string }) => void;
  closeArtifactViewer: () => void;
  /** Artifacts pinned to the next chat message(s) as @ context. */
  artifactMentions: Array<{ id: string; name: string }>;
  addArtifactMention: (artifact: { id: string; name: string }) => void;
  removeArtifactMention: (id: string) => void;
  clearArtifactMentions: () => void;
  /** Open chat with a page agent (or given agent), new thread, and pin an artifact. */
  discussArtifactInChat: (opts: {
    id: string;
    name: string;
    agentId?: string;
    prompt?: string;
  }) => void;
  /** When true, IntelligencePanel should start a fresh chat thread once. */
  requestNewChat: boolean;
  clearNewChatRequest: () => void;
  /** Session toggle: auto-approve confirm-gated tools (kill-switches still prompt). */
  autoAcceptTools: boolean;
  setAutoAcceptTools: (enabled: boolean) => void;
  /** Agent / Plan / Ask chat mode (Cursor parity). */
  chatMode: IntelligenceChatMode;
  setChatMode: (mode: IntelligenceChatMode) => void;
  /** Tool autonomy profile for the session. */
  toolAutonomy: ToolAutonomyLevel;
  setToolAutonomy: (level: ToolAutonomyLevel) => void;
}

export type PanelTab =
  | "chat"
  | "notifications"
  | "calendar"
  | "projects"
  | "knowledge"
  | "bank"
  | "vault"
  | "support"
  | "dms"
  | "channels";

export type AgentsSection =
  | "organization"
  | "pipeline"
  | "workflows"
  | "activity";

export type KnowledgeSubTab =
  | "rules"
  | "skills"
  | "memory"
  | "artifacts"
  | "reflection"
  | "tools";

const IntelligenceCtx = createContext<IntelligenceContextValue | null>(null);

/** Shared sizing constants for the floating AI modal. */
export const MIN_COMPOSER_WIDTH = 320;
export const MAX_COMPOSER_WIDTH = 900;
export const DEFAULT_COMPOSER_WIDTH = 560;
export const MIN_PANEL_HEIGHT = 240;
export const DEFAULT_PANEL_HEIGHT = 480;

function readStoredPanelTab(): PanelTab {
  if (typeof window === "undefined") return "chat";
  const v = readMigratedKey(PANEL_TAB_KEY, LEGACY_PANEL_TAB_KEY);
  if (v === "builder" || v === "workflow" || v === "agents") return "chat";
  return v === "notifications" ||
    v === "calendar" ||
    v === "projects" ||
    v === "knowledge" ||
    v === "bank" ||
    v === "vault" ||
    v === "support" ||
    v === "dms" ||
    v === "channels"
    ? v
    : "chat";
}

function readStoredAgentsSection(): AgentsSection {
  if (typeof window === "undefined") return "organization";
  const stored = readMigratedKey(AGENTS_SECTION_KEY, LEGACY_AGENTS_SECTION_KEY);
  if (
    stored === "organization" ||
    stored === "pipeline" ||
    stored === "workflows" ||
    stored === "activity"
  ) {
    return stored;
  }
  const legacyTab = readMigratedKey(PANEL_TAB_KEY, LEGACY_PANEL_TAB_KEY);
  if (legacyTab === "workflow") return "workflows";
  const legacyMode = readMigratedKey(
    "godmode.agents.mode",
    LEGACY_AGENTS_MODE_KEY_OLD
  );
  return legacyMode === "pipeline" ? "pipeline" : "organization";
}

/** Clamp the composer width to [MIN, min(MAX, availableWidth)]. */
export function clampComposerWidth(width: number, availableWidth?: number): number {
  const upper = availableWidth && availableWidth > 0 ? availableWidth : MAX_COMPOSER_WIDTH;
  return Math.max(MIN_COMPOSER_WIDTH, Math.min(upper, Math.round(width)));
}

/** Clamp the modal height to [MIN, maxAvailable]. */
export function clampPanelHeight(height: number, maxAvailable?: number): number {
  const upper =
    maxAvailable && maxAvailable > 0
      ? Math.max(MIN_PANEL_HEIGHT, maxAvailable)
      : Number.POSITIVE_INFINITY;
  return Math.max(MIN_PANEL_HEIGHT, Math.min(upper, Math.round(height)));
}

function readStoredNumber(newKey: string, legacyKey: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = readMigratedKey(newKey, legacyKey);
  if (raw == null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readStoredNumberOrNull(newKey: string, legacyKey: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = readMigratedKey(newKey, legacyKey);
  if (raw == null) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function computeBreadcrumb(
  pathname: string,
  departments: DepartmentNode[]
): { crumb: string[]; pageKind?: string; pageLabel?: string } {
  const chromeless = chromelessHeaderSegments(pathname);
  if (chromeless) {
    const pageLabel = chromeless[chromeless.length - 1];
    return {
      crumb: chromeless,
      pageKind: isChromelessPath(pathname) ? "platform" : undefined,
      pageLabel,
    };
  }

  const dept = departmentFromPath(pathname, departments);
  const div = divisionFromPath(pathname, departments);
  const crumb: string[] = [];
  if (dept) crumb.push(dept.label);
  if (div) crumb.push(div.label);

  let pageKind: string | undefined;
  let pageLabel: string | undefined;
  if (div) {
    for (const p of div.pages) {
      const full =
        p.segment === ""
          ? div.basePath
          : `${div.basePath.replace(/\/$/, "")}/${p.segment}`;
      if (pathname === full || pathname === `${full}/`) {
        pageKind = p.kind;
        pageLabel = p.label;
        crumb.push(p.label);
        break;
      }
    }
  }

  return { crumb, pageKind, pageLabel };
}

export function IntelligenceProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { departments } = useStructure();
  const { user } = useTenant();
  const [pageSnapshot, setPageSnapshot] = useState<PageContextSnapshot | null>(
    null
  );
  const [mentionSources, setMentionSources] = useState<MentionSource[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMaximized, setPanelMaximized] = useState(false);
  const [seedText, setSeedText] = useState("");
  const [autoSendPrompt, setAutoSendPrompt] = useState<string | null>(null);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [composerWidth, setComposerWidthState] = useState(() =>
    clampComposerWidth(
      readStoredNumber(COMPOSER_WIDTH_KEY, LEGACY_COMPOSER_WIDTH_KEY, DEFAULT_COMPOSER_WIDTH)
    )
  );
  const [panelHeight, setPanelHeightState] = useState(() =>
    clampPanelHeight(
      readStoredNumber(PANEL_HEIGHT_KEY, LEGACY_PANEL_HEIGHT_KEY, DEFAULT_PANEL_HEIGHT)
    )
  );
  const [panelX, setPanelXState] = useState<number | null>(() =>
    readStoredNumberOrNull(PANEL_X_KEY, LEGACY_PANEL_X_KEY)
  );
  const [panelY, setPanelYState] = useState<number | null>(() =>
    readStoredNumberOrNull(PANEL_Y_KEY, LEGACY_PANEL_Y_KEY)
  );
  const [panelTab, setPanelTabState] = useState<PanelTab>(readStoredPanelTab);
  const [agentsSection, setAgentsSectionState] = useState<AgentsSection>(
    readStoredAgentsSection
  );

  const [reviewUnread, setReviewUnread] = useState(0);
  const bumpReviewUnread = useCallback(() => setReviewUnread((n) => n + 1), []);
  const clearReviewUnread = useCallback(() => setReviewUnread(0), []);
  const [knowledgeSubTab, setKnowledgeSubTabState] = useState<KnowledgeSubTab>("rules");
  const setKnowledgeSubTab = useCallback(
    (tab: KnowledgeSubTab) => setKnowledgeSubTabState(tab),
    []
  );
  const [artifactViewer, setArtifactViewer] = useState<{
    id: string;
    name?: string;
  } | null>(null);
  const openArtifactViewer = useCallback((opts: { id: string; name?: string }) => {
    setArtifactViewer({ id: opts.id, name: opts.name });
  }, []);
  const closeArtifactViewer = useCallback(() => setArtifactViewer(null), []);
  const [artifactMentions, setArtifactMentions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const addArtifactMention = useCallback((artifact: { id: string; name: string }) => {
    setArtifactMentions((prev) => {
      if (prev.some((a) => a.id === artifact.id)) return prev;
      return [...prev, artifact];
    });
  }, []);
  const removeArtifactMention = useCallback((id: string) => {
    setArtifactMentions((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const clearArtifactMentions = useCallback(() => setArtifactMentions([]), []);
  const [requestNewChat, setRequestNewChat] = useState(false);
  const clearNewChatRequest = useCallback(() => setRequestNewChat(false), []);
  const [autoAcceptTools, setAutoAcceptToolsState] = useState(() => {
    if (typeof window === "undefined") return false;
    return readStorageKey(AUTO_ACCEPT_TOOLS_KEY) === "1";
  });
  const setAutoAcceptTools = useCallback((enabled: boolean) => {
    setAutoAcceptToolsState(enabled);
    writeStorageKey(AUTO_ACCEPT_TOOLS_KEY, enabled ? "1" : "0");
    if (enabled) {
      setToolAutonomyState("full");
      writeStorageKey(TOOL_AUTONOMY_KEY, "full");
    }
  }, []);
  const [chatMode, setChatModeState] = useState<IntelligenceChatMode>(() => {
    if (typeof window === "undefined") return "agent";
    const v = readStorageKey(CHAT_MODE_KEY);
    return v === "plan" || v === "ask" ? v : "agent";
  });
  const setChatMode = useCallback((mode: IntelligenceChatMode) => {
    setChatModeState(mode);
    writeStorageKey(CHAT_MODE_KEY, mode);
  }, []);
  const [toolAutonomy, setToolAutonomyState] = useState<ToolAutonomyLevel>(() => {
    if (typeof window === "undefined") return "off";
    const v = readStorageKey(TOOL_AUTONOMY_KEY);
    if (v === "writes" || v === "full") return v;
    return readStorageKey(AUTO_ACCEPT_TOOLS_KEY) === "1" ? "full" : "off";
  });
  const setToolAutonomy = useCallback((level: ToolAutonomyLevel) => {
    setToolAutonomyState(level);
    writeStorageKey(TOOL_AUTONOMY_KEY, level);
    setAutoAcceptToolsState(level === "full");
    writeStorageKey(AUTO_ACCEPT_TOOLS_KEY, level === "full" ? "1" : "0");
  }, []);
  const [activeAgentId, setActiveAgentIdState] = useState(() => {
    if (typeof window === "undefined") return "intelligence";
    const stored =
      readMigratedKey(ACTIVE_AGENT_KEY, LEGACY_ACTIVE_AGENT_KEY) ??
      readMigratedKey(ACTIVE_AGENT_KEY, "moneyai.activeAgentId");
    if (stored === "money-ai") return "intelligence";
    if (stored === "cursor" || stored === "pi") return "intelligence";
    return stored || "intelligence";
  });
  const [chatTarget, setChatTargetState] = useState<ChatTarget>(() => {
    if (typeof window === "undefined") {
      return { kind: "agent", agentId: "intelligence" };
    }
    const stored =
      readMigratedKey(ACTIVE_AGENT_KEY, LEGACY_ACTIVE_AGENT_KEY) ??
      readMigratedKey(ACTIVE_AGENT_KEY, "moneyai.activeAgentId");
    const id =
      stored === "money-ai" || stored === "cursor" || stored === "pi"
        ? "intelligence"
        : stored || "intelligence";
    return { kind: "agent", agentId: id };
  });
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [dmUnreadCount, setDmUnreadCount] = useState(0);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [dmMessageListeners] = useState(
    () => new Set<(msg: DmMessage, conversationId: string) => void>()
  );

  const setChatTarget = useCallback((target: ChatTarget) => {
    setChatTargetState(target);
    if (target.kind === "agent") {
      setActiveAgentIdState(target.agentId);
      if (typeof window !== "undefined") {
        writeMigratedKey(ACTIVE_AGENT_KEY, LEGACY_ACTIVE_AGENT_KEY, target.agentId);
      }
    }
  }, []);

  const refreshDmConversations = useCallback(async () => {
    try {
      const res = await fetchDmConversations();
      setDmConversations(res.conversations);
      const total = res.conversations.reduce((s, c) => s + c.unreadCount, 0);
      setDmUnreadCount(total);
    } catch {
      /* ignore */
    }
  }, []);

  const onDmIncomingMessage = useCallback(
    (cb: (msg: DmMessage, conversationId: string) => void) => {
      dmMessageListeners.add(cb);
      return () => dmMessageListeners.delete(cb);
    },
    [dmMessageListeners]
  );

  const refreshNotificationsUnread = useCallback(async () => {
    try {
      const res = await fetchNotificationUnreadCount();
      setNotificationsUnread(res.unreadCount);
    } catch {
      /* ignore */
    }
  }, []);

  const setActiveAgentId = useCallback((id: string) => {
    setActiveAgentIdState(id);
    setChatTargetState({ kind: "agent", agentId: id });
    if (typeof window !== "undefined") {
      writeMigratedKey(ACTIVE_AGENT_KEY, LEGACY_ACTIVE_AGENT_KEY, id);
    }
  }, []);

  const setPanelTab = useCallback((tab: PanelTab) => {
    setPanelTabState(tab);
    if (typeof window !== "undefined") {
      writeMigratedKey(PANEL_TAB_KEY, LEGACY_PANEL_TAB_KEY, tab);
    }
  }, []);

  const setAgentsSection = useCallback((section: AgentsSection) => {
    setAgentsSectionState(section);
    if (typeof window !== "undefined") {
      writeMigratedKey(AGENTS_SECTION_KEY, LEGACY_AGENTS_SECTION_KEY, section);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored =
      readMigratedKey(ACTIVE_AGENT_KEY, LEGACY_ACTIVE_AGENT_KEY) ??
      readMigratedKey(ACTIVE_AGENT_KEY, "moneyai.activeAgentId");
    if (stored === "money-ai") {
      writeMigratedKey(ACTIVE_AGENT_KEY, LEGACY_ACTIVE_AGENT_KEY, "intelligence");
      setActiveAgentIdState("intelligence");
    }
    const legacyTab = readMigratedKey(PANEL_TAB_KEY, LEGACY_PANEL_TAB_KEY);
    if (legacyTab === "workflow") {
      setAgentsSectionState("workflows");
      writeMigratedKey(PANEL_TAB_KEY, LEGACY_PANEL_TAB_KEY, "chat");
      writeMigratedKey(AGENTS_SECTION_KEY, LEGACY_AGENTS_SECTION_KEY, "workflows");
    }
  }, []);

  const setPanelPos = useCallback((x: number, y: number) => {
    setPanelXState(x);
    setPanelYState(y);
    if (typeof window !== "undefined") {
      writeMigratedKey(PANEL_X_KEY, LEGACY_PANEL_X_KEY, String(Math.round(x)));
      writeMigratedKey(PANEL_Y_KEY, LEGACY_PANEL_Y_KEY, String(Math.round(y)));
    }
  }, []);

  const setComposerWidth = useCallback((width: number) => {
    setComposerWidthState(width);
    if (typeof window !== "undefined") {
      writeMigratedKey(
        COMPOSER_WIDTH_KEY,
        LEGACY_COMPOSER_WIDTH_KEY,
        String(Math.round(width))
      );
    }
  }, []);

  const setPanelHeight = useCallback((height: number) => {
    setPanelHeightState(height);
    if (typeof window !== "undefined") {
      writeMigratedKey(
        PANEL_HEIGHT_KEY,
        LEGACY_PANEL_HEIGHT_KEY,
        String(Math.round(height))
      );
    }
  }, []);

  const togglePanel = useCallback(() => setPanelOpen((o) => !o), []);

  const openPanel = useCallback(
    (opts?: {
      tab?: PanelTab;
      agentId?: string;
      conversationId?: string;
      contactUserId?: string;
      maximized?: boolean;
      prompt?: string;
      autoSend?: boolean;
      knowledgeSubTab?: KnowledgeSubTab;
      artifactId?: string;
      artifactName?: string;
    }) => {
      if (opts?.conversationId) {
        setChatTarget({ kind: "conversation", conversationId: opts.conversationId });
      } else if (opts?.agentId) {
        setChatTarget({ kind: "agent", agentId: opts.agentId });
      } else if (opts?.contactUserId) {
        void createDmConversation({
          kind: "direct",
          memberUserIds: [opts.contactUserId],
        })
          .then((r) => {
            setChatTarget({
              kind: "conversation",
              conversationId: r.conversation.id,
            });
            void refreshDmConversations();
          })
          .catch(() => undefined);
      }
      setPanelOpen(true);
      if (opts?.tab) setPanelTab(opts.tab);
      if (opts?.knowledgeSubTab) setKnowledgeSubTab(opts.knowledgeSubTab);
      if (opts?.artifactId) {
        setKnowledgeSubTab("artifacts");
        setPanelTab("knowledge");
        setArtifactViewer({ id: opts.artifactId, name: opts.artifactName });
      }
      if (opts?.maximized) setPanelMaximized(true);
      if (opts?.prompt) {
        if (opts.autoSend) setAutoSendPrompt(opts.prompt);
        else setSeedText(opts.prompt);
      }
    },
    [setPanelTab, setChatTarget, refreshDmConversations, setKnowledgeSubTab]
  );

  const discussArtifactInChat = useCallback(
    (opts: { id: string; name: string; agentId?: string; prompt?: string }) => {
      const agentId = opts.agentId ?? activeAgentId;
      setChatTarget({ kind: "agent", agentId });
      setPanelTab("chat");
      setPanelOpen(true);
      addArtifactMention({ id: opts.id, name: opts.name });
      setRequestNewChat(true);
      setSeedText(
        opts.prompt ??
          `I have questions about the attached report "${opts.name}".`
      );
    },
    [activeAgentId, setChatTarget, setPanelTab, addArtifactMention]
  );

  useEffect(() => {
    if (!user) return;
    void refreshDmConversations();
    void refreshNotificationsUnread();
  }, [user, refreshDmConversations, refreshNotificationsUnread]);

  useEffect(() => {
    if (!user) return;
    let sock: WebSocket | null = null;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const tenantId = readTenantId();
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    sock = new WebSocket(`${proto}//${host}/ws${qs}`);

    sock.onopen = () => {
      if (tenantId) {
        sock?.send(JSON.stringify({ type: "join_room", room: `tenant:${tenantId}` }));
      }
      sock?.send(JSON.stringify({ type: "join_room", room: `user:${user.id}` }));
    };

    sock.onmessage = (ev) => {
      try {
        const raw = JSON.parse(ev.data) as {
          type?: string;
          data?: {
            message?: DmMessage;
            conversationId?: string;
            conversation?: DmConversation;
          };
        };
        if (raw.type === "dm_message" && raw.data?.message) {
          const incoming = raw.data.message;
          const convId = raw.data.conversationId ?? incoming.conversationId;
          for (const cb of dmMessageListeners) {
            cb(incoming, convId);
          }
          const activeConvId =
            chatTarget.kind === "conversation" ? chatTarget.conversationId : null;
          if (
            incoming.senderUserId !== user.id &&
            (!panelOpen || activeConvId !== convId)
          ) {
            setDmUnreadCount((n) => n + 1);
            const preview = incoming.bodyText?.trim() || "New message";
            toast(preview, {
              action: {
                label: "Open",
                onClick: () =>
                  openPanel({ conversationId: convId, tab: "chat" }),
              },
            });
          }
          void refreshDmConversations();
        }
        if (
          raw.type === "dm_conversation_created" ||
          raw.type === "dm_member_added" ||
          raw.type === "dm_member_removed"
        ) {
          void refreshDmConversations();
        }
        if (raw.type === "dm_read") {
          void fetchDmUnread()
            .then((r) => setDmUnreadCount(r.unread))
            .catch(() => undefined);
        }
        if (raw.type === "notification") {
          setNotificationsUnread((n) => n + 1);
          const notif = (
            raw.data as { notification?: { title?: string; link?: string } } | undefined
          )?.notification;
          if (notif?.title) {
            toast(notif.title, {
              action: notif.link
                ? {
                    label: "Open",
                    onClick: () => {
                      window.location.href = notif.link as string;
                    },
                  }
                : undefined,
            });
          }
        }
      } catch {
        /* ignore */
      }
    };

    return () => {
      sock?.close();
    };
  }, [
    user,
    dmMessageListeners,
    refreshDmConversations,
    panelOpen,
    chatTarget,
    openPanel,
  ]);

  // Global Ctrl/Cmd+L toggles the Intelligence panel, mirroring Cursor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setPanelOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset the per-page snapshot whenever the route changes so stale page
  // data from a previous page doesn't leak into the model's context.
  useEffect(() => {
    setPageSnapshot(null);
  }, [pathname]);

  const { crumb, pageKind, pageLabel } = useMemo(
    () => computeBreadcrumb(pathname, departments),
    [pathname, departments]
  );

  const registerMentionSource = useCallback((src: MentionSource) => {
    setMentionSources((prev) => {
      const next = prev.filter((s) => s.id !== src.id);
      next.push(src);
      return next;
    });
    return () => {
      setMentionSources((prev) => prev.filter((s) => s.id !== src.id));
    };
  }, []);

  const buildPlatformContext = useCallback(
    async (mentionIds: string[]): Promise<PlatformContextPayload> => {
      const mentioned: Array<{ id: string; label: string; data: unknown }> = [];
      for (const id of mentionIds) {
        const src = mentionSources.find((s) => s.id === id);
        if (!src) continue;
        try {
          mentioned.push({ id: src.id, label: src.label, data: await src.resolve() });
        } catch {
          /* skip sources that fail to resolve */
        }
      }
      return {
        breadcrumb: crumb,
        pathname,
        pageKind,
        pageLabel,
        pageSnapshot: pageSnapshot?.data,
        mentionedSources: mentioned.length ? mentioned : undefined,
      };
    },
    [crumb, pathname, pageKind, pageLabel, pageSnapshot, mentionSources]
  );

  const captureScreenshot = useCallback(async (): Promise<string | null> => {
    const target =
      document.querySelector("main") ?? document.body;
    if (!target) return null;
    try {
      return await toPng(target as HTMLElement, {
        cacheBust: true,
        pixelRatio: 1,
        backgroundColor: "#0a0a0a",
      });
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<IntelligenceContextValue>(
    () => ({
      breadcrumb: crumb,
      pathname,
      pageSnapshot,
      setPageSnapshot,
      mentionSources,
      registerMentionSource,
      buildPlatformContext,
      captureScreenshot,
      panelOpen,
      setPanelOpen,
      togglePanel,
      panelMaximized,
      setPanelMaximized,
      openPanel,
      seedText,
      setSeedText,
      autoSendPrompt,
      setAutoSendPrompt,
      pendingChatId,
      setPendingChatId,
      composerWidth,
      setComposerWidth,
      panelHeight,
      setPanelHeight,
      panelX,
      panelY,
      setPanelPos,
      panelTab,
      setPanelTab,
      agentsSection,
      setAgentsSection,
      activeAgentId,
      setActiveAgentId,
      chatTarget,
      setChatTarget,
      dmConversations,
      refreshDmConversations,
      dmUnreadCount,
      onDmIncomingMessage,
      notificationsUnread,
      refreshNotificationsUnread,
      reviewUnread,
      bumpReviewUnread,
      clearReviewUnread,
      knowledgeSubTab,
      setKnowledgeSubTab,
      artifactViewer,
      openArtifactViewer,
      closeArtifactViewer,
      artifactMentions,
      addArtifactMention,
      removeArtifactMention,
      clearArtifactMentions,
      discussArtifactInChat,
      requestNewChat,
      clearNewChatRequest,
      autoAcceptTools,
      setAutoAcceptTools,
      chatMode,
      setChatMode,
      toolAutonomy,
      setToolAutonomy,
    }),
    [
      crumb,
      pathname,
      pageSnapshot,
      mentionSources,
      registerMentionSource,
      buildPlatformContext,
      captureScreenshot,
      panelOpen,
      togglePanel,
      panelMaximized,
      openPanel,
      seedText,
      autoSendPrompt,
      pendingChatId,
      composerWidth,
      setComposerWidth,
      panelHeight,
      setPanelHeight,
      panelX,
      panelY,
      setPanelPos,
      panelTab,
      setPanelTab,
      agentsSection,
      setAgentsSection,
      activeAgentId,
      setActiveAgentId,
      chatTarget,
      setChatTarget,
      dmConversations,
      refreshDmConversations,
      dmUnreadCount,
      onDmIncomingMessage,
      notificationsUnread,
      refreshNotificationsUnread,
      reviewUnread,
      bumpReviewUnread,
      clearReviewUnread,
      knowledgeSubTab,
      setKnowledgeSubTab,
      artifactViewer,
      openArtifactViewer,
      closeArtifactViewer,
      artifactMentions,
      addArtifactMention,
      removeArtifactMention,
      clearArtifactMentions,
      discussArtifactInChat,
      requestNewChat,
      clearNewChatRequest,
      autoAcceptTools,
      setAutoAcceptTools,
      chatMode,
      setChatMode,
      toolAutonomy,
      setToolAutonomy,
    ]
  );

  return <IntelligenceCtx.Provider value={value}>{children}</IntelligenceCtx.Provider>;
}

export function useIntelligence(): IntelligenceContextValue {
  const ctx = useContext(IntelligenceCtx);
  if (!ctx) {
    throw new Error("useIntelligence must be used within IntelligenceProvider");
  }
  return ctx;
}

/**
 * Pages call this to publish their structured data to Intelligence. The snapshot
 * is automatically cleared on navigation. `data` should be cheap to serialize.
 */
export function usePageContext(snapshot: PageContextSnapshot | null): void {
  const ctx = useContext(IntelligenceCtx);
  const serialized = snapshot ? JSON.stringify(snapshot) : null;
  useEffect(() => {
    if (!ctx) return;
    ctx.setPageSnapshot(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);
}

/**
 * Registers an @-mentionable context source for the lifetime of the component.
 */
export function useMentionSource(src: MentionSource | null): void {
  const ctx = useContext(IntelligenceCtx);
  const key = src ? `${src.id}|${src.label}` : null;
  useEffect(() => {
    if (!ctx || !src) return;
    return ctx.registerMentionSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
