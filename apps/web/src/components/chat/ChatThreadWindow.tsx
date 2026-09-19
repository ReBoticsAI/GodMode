import { useCallback, useEffect, useRef, useState } from "react";
import { BotIcon, HashIcon, MessageCircleIcon } from "lucide-react";
import { FloatingWindow } from "@/components/floating/FloatingWindow";
import { MessageBubble } from "@/components/messages/MessageBubble";
import {
  fetchDmMessages,
  markDmConversationRead,
  type DmMessage,
} from "@/api";
import { useIntelligence } from "@/lib/intelligence-context";
import type { OpenChatWindow } from "@/lib/chat-windows";
import { cn } from "@/lib/utils";
import { useTenant } from "@/lib/tenant-context";

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function AgentTranscript({
  lines,
}: {
  lines: NonNullable<OpenChatWindow["etherLines"]>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Replies appear here. Send from the bottom composer.
        </p>
      ) : null}
      {lines.map((l) => (
        <p
          key={l.id}
          className={cn(
            "text-[12px] leading-snug",
            l.role === "system" ? "text-destructive/80" : "text-foreground/85"
          )}
        >
          <span className="text-foreground/35">[{formatTime(l.at)}]</span>{" "}
          <span
            className={cn(
              "font-medium",
              l.role === "assistant"
                ? "text-primary"
                : l.role === "user"
                  ? "text-foreground"
                  : "text-destructive"
            )}
          >
            {l.role === "assistant"
              ? "Intelligence"
              : l.role === "user"
                ? "You"
                : "System"}
          </span>
          <span className="text-foreground/40">:</span>{" "}
          <span className="whitespace-pre-wrap break-words">
            {l.text || (l.streaming ? "…" : "")}
          </span>
        </p>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function ConversationTranscript({ conversationId }: { conversationId: string }) {
  const { user } = useTenant();
  const { onDmIncomingMessage, refreshDmConversations } = useIntelligence();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetchDmMessages(conversationId, { limit: 100 });
    setMessages(res.messages);
    const last = res.messages[res.messages.length - 1];
    if (last) {
      await markDmConversationRead(conversationId, last.id);
      void refreshDmConversations();
    }
  }, [conversationId, refreshDmConversations]);

  useEffect(() => {
    void load().catch(() => setMessages([]));
  }, [load]);

  useEffect(() => {
    return onDmIncomingMessage((msg, convId) => {
      if (convId !== conversationId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      void markDmConversationRead(conversationId, msg.id)
        .then(() => refreshDmConversations())
        .catch(() => undefined);
    });
  }, [conversationId, onDmIncomingMessage, refreshDmConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {messages.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No messages yet. Send from the bottom composer.
        </p>
      ) : null}
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          isOwn={m.senderUserId === user?.id}
          conversationId={conversationId}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

export function ChatThreadWindow({
  win,
  composerText,
  onComposerDraftChange,
}: {
  win: OpenChatWindow;
  /** Current bottom-composer text (for draft stash on focus). */
  composerText: string;
  onComposerDraftChange: (text: string) => void;
}) {
  const {
    focusedChatWindowId,
    focusChatWindow,
    closeChatWindow,
    setChatWindowMinimized,
  } = useIntelligence();
  const focused = focusedChatWindowId === win.id;

  const activate = () => {
    const restored = focusChatWindow(win.id, composerText);
    onComposerDraftChange(restored);
  };

  const icon =
    win.kind === "agent" ? (
      <BotIcon className="size-4" />
    ) : win.kind === "channel" ? (
      <HashIcon className="size-4" />
    ) : (
      <MessageCircleIcon className="size-4" />
    );

  return (
    <FloatingWindow
      open
      minimized={Boolean(win.minimized)}
      onMinimize={() => setChatWindowMinimized(win.id, true)}
      title={
        <button
          type="button"
          className="appearance-none truncate bg-transparent text-left font-medium text-foreground outline-none select-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 active:bg-transparent"
          aria-label={`Move ${win.title} window`}
          onClick={activate}
        >
          {win.title}
          {focused ? (
            <span className="ml-1.5 text-[10px] font-normal text-primary">
              focused
            </span>
          ) : null}
        </button>
      }
      icon={icon}
      accent={focused ? "#7c3aed" : "#a78bfa"}
      zIndexClassName={focused ? "z-[120]" : "z-[110]"}
      defaultWidth={420}
      defaultHeight={480}
      placement={win.kind === "agent" ? "focus-left" : "focus-right"}
      windowId={win.id}
      role="chat"
      onClose={() => closeChatWindow(win.id)}
      className={cn(focused && "ring-1 ring-primary/40")}
    >
      <div
        className="flex h-full min-h-0 flex-col"
        onPointerDown={() => {
          if (focusedChatWindowId !== win.id) activate();
        }}
      >
        {win.kind === "agent" ? (
          <AgentTranscript lines={win.etherLines ?? []} />
        ) : win.conversationId ? (
          <ConversationTranscript conversationId={win.conversationId} />
        ) : (
          <p className="p-3 text-xs text-muted-foreground">Missing conversation.</p>
        )}
        <p className="shrink-0 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          Reply with the bottom composer
          {focused ? " (this window is focused)" : ". Click to focus."}
        </p>
      </div>
    </FloatingWindow>
  );
}

export function ChatThreadWindowsHost({
  composerText,
  onComposerDraftChange,
}: {
  composerText: string;
  onComposerDraftChange: (text: string) => void;
}) {
  const { openChatWindows } = useIntelligence();
  return (
    <>
      {openChatWindows.map((win) => (
        <ChatThreadWindow
          key={win.id}
          win={win}
          composerText={composerText}
          onComposerDraftChange={onComposerDraftChange}
        />
      ))}
    </>
  );
}
