import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  fetchDmConversations,
  fetchDmUnread,
  type DmConversation,
  type DmMessage,
} from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { readTenantId } from "@/lib/storage-keys";

interface MessagesContextValue {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  openPanel: (opts?: { conversationId?: string }) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  conversations: DmConversation[];
  refreshConversations: () => Promise<void>;
  unreadCount: number;
  bumpUnread: () => void;
  setUnreadCount: (n: number) => void;
  onIncomingMessage: (cb: (msg: DmMessage, conversationId: string) => void) => () => void;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

export function MessagesProvider({ children }: { children: ReactNode }) {
  const { user } = useTenant();
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messageListeners] = useState(
    () => new Set<(msg: DmMessage, conversationId: string) => void>()
  );

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetchDmConversations();
      setConversations(res.conversations);
      const total = res.conversations.reduce((s, c) => s + c.unreadCount, 0);
      setUnreadCount(total);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetchDmUnread();
      setUnreadCount(res.unread);
    } catch {
      /* ignore */
    }
  }, []);

  const bumpUnread = useCallback(() => {
    setUnreadCount((n) => n + 1);
  }, []);

  const openPanel = useCallback((opts?: { conversationId?: string }) => {
    setPanelOpen(true);
    if (opts?.conversationId) setActiveConversationId(opts.conversationId);
  }, []);

  const onIncomingMessage = useCallback(
    (cb: (msg: DmMessage, conversationId: string) => void) => {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    [messageListeners]
  );

  useEffect(() => {
    if (!user) return;
    void refreshConversations();
  }, [user, refreshConversations]);

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
          for (const cb of messageListeners) {
            cb(incoming, convId);
          }
          if (
            incoming.senderUserId !== user.id &&
            (!panelOpen || activeConversationId !== convId)
          ) {
            bumpUnread();
            const preview = incoming.bodyText?.trim() || "New message";
            toast(preview, {
              action: {
                label: "Open",
                onClick: () => openPanel({ conversationId: convId }),
              },
            });
          }
          void refreshConversations();
        }
        if (
          raw.type === "dm_conversation_created" ||
          raw.type === "dm_member_added" ||
          raw.type === "dm_member_removed"
        ) {
          void refreshConversations();
        }
        if (raw.type === "dm_read") {
          void refreshUnread();
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
    messageListeners,
    refreshConversations,
    refreshUnread,
    panelOpen,
    activeConversationId,
    bumpUnread,
    openPanel,
  ]);

  const value = useMemo(
    () => ({
      panelOpen,
      setPanelOpen,
      openPanel,
      activeConversationId,
      setActiveConversationId,
      conversations,
      refreshConversations,
      unreadCount,
      bumpUnread,
      setUnreadCount,
      onIncomingMessage,
    }),
    [
      panelOpen,
      openPanel,
      activeConversationId,
      conversations,
      refreshConversations,
      unreadCount,
      bumpUnread,
      onIncomingMessage,
    ]
  );

  return (
    <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
  );
}

export function useMessages() {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used within MessagesProvider");
  return ctx;
}
