import { useCallback, useEffect, useRef, useState } from "react";
import { UserPlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addDmConversationMember,
  fetchDmConversation,
  fetchDmMessages,
  markDmConversationRead,
  removeDmConversationMember,
  sendDmMessage,
  sendDmTyping,
  type DmConversation,
  type DmMessage,
} from "@/api";
import { useMessages } from "@/lib/messages-context";
import { readTenantId } from "@/lib/storage-keys";
import { useTenant } from "@/lib/tenant-context";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";

interface MessageThreadProps {
  conversationId: string;
}

export function MessageThread({ conversationId }: MessageThreadProps) {
  const { user } = useTenant();
  const { onIncomingMessage, refreshConversations } = useMessages();
  const [conversation, setConversation] = useState<DmConversation | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [addEmail, setAddEmail] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [convRes, msgRes] = await Promise.all([
      fetchDmConversation(conversationId),
      fetchDmMessages(conversationId, { limit: 100 }),
    ]);
    setConversation(convRes.conversation);
    setMessages(msgRes.messages);
    const last = msgRes.messages[msgRes.messages.length - 1];
    if (last) {
      await markDmConversationRead(conversationId, last.id);
      void refreshConversations();
    }
  }, [conversationId, refreshConversations]);

  useEffect(() => {
    void load().catch(() => {
      setConversation(null);
      setMessages([]);
    });
  }, [load]);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const tenantId = readTenantId();
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    const sock = new WebSocket(`${proto}//${host}/ws${qs}`);
    sock.onopen = () => {
      sock.send(
        JSON.stringify({
          type: "join_resource",
          kind: "conversation",
          resourceId: conversationId,
        })
      );
    };
    return () => sock.close();
  }, [conversationId]);

  useEffect(() => {
    return onIncomingMessage((msg, convId) => {
      if (convId !== conversationId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      void markDmConversationRead(conversationId, msg.id);
      void refreshConversations();
    });
  }, [conversationId, onIncomingMessage, refreshConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (payload: {
    bodyText: string;
    attachments: Parameters<typeof sendDmMessage>[1]["attachments"];
  }) => {
    const res = await sendDmMessage(conversationId, payload);
    setMessages((prev) => [...prev, res.message]);
    void refreshConversations();
  };

  const handleTyping = () => {
    if (typingTimer.current) return;
    void sendDmTyping(conversationId).catch(() => undefined);
    typingTimer.current = setTimeout(() => {
      typingTimer.current = null;
    }, 2000);
  };

  const addMember = async () => {
    const trimmed = addEmail.trim();
    if (!trimmed) return;
    try {
      await addDmConversationMember(conversationId, { email: trimmed });
      toast.success("Member added");
      setAddEmail("");
      setShowAddMember(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member");
    }
  };

  const removeMember = async (userId: string) => {
    try {
      await removeDmConversationMember(conversationId, userId);
      toast.success("Member removed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const isGroup = conversation.kind === "group";
  const myRole = conversation.members.find(
    (m) => m.memberKind === "user" && m.userId === user?.id
  )?.role;

  return (
    <div className="flex h-full flex-col flex-1 min-w-0">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div>
          <p className="text-sm font-medium">{conversation.displayTitle}</p>
          <p className="text-[10px] text-muted-foreground">
            {conversation.members
              .map((m) => m.user?.displayName ?? m.agent?.name)
              .filter(Boolean)
              .join(", ")}
          </p>
        </div>
        {isGroup && myRole === "owner" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setShowAddMember((v) => !v)}
          >
            <UserPlusIcon className="size-4" />
          </Button>
        ) : null}
      </div>

      {showAddMember ? (
        <div className="flex gap-2 border-b p-2">
          <Input
            placeholder="Add by email"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" onClick={() => void addMember()}>
            Add
          </Button>
        </div>
      ) : null}

      {isGroup && myRole === "owner" ? (
        <div className="flex flex-wrap gap-1 border-b px-2 py-1">
          {conversation.members.map((m) => (
            <span
              key={m.userId ?? m.agentId ?? m.joinedAt}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
            >
              {m.user?.displayName ?? m.agent?.name ?? "Member"}
              {m.userId && m.userId !== user?.id ? (
                <button
                  type="button"
                  onClick={() => void removeMember(m.userId!)}
                >
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            isOwn={m.senderUserId === user?.id}
            conversationId={conversationId}
            showShareAccess
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div onKeyDown={handleTyping}>
        <MessageComposer onSend={handleSend} />
      </div>
    </div>
  );
}
