import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  ArrowUpIcon,
  MicIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { ensureAgentDm, fetchDmDirectory, sendDmMessage } from "@/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { isChannelAgentId } from "@/lib/focus-chrome";
import { useIntelligence } from "@/lib/intelligence-context";
import { useGraphFocusChip } from "@/lib/use-graph-focus-chip";
import { cn } from "@/lib/utils";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: {
    results: ArrayLike<{ 0: { transcript: string } }>;
  }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Cursor-style pill message box anchored bottom-center on the Graph.
 * Agent and conversation replies open IntelligencePanel. The page composer follows chatTarget.
 */
export function GraphEtherComposer({
  className,
  statusChips,
  value,
  onValueChange,
  placeholder = "Ask Intelligence, or filter the Graph…",
  browseActive = false,
  onBrowseEnter,
  onSuggestEnter,
  onSuggestArrow,
  onAskForce,
  onComposerEscape,
  inputRef,
  sendRequestId = 0,
}: {
  className?: string;
  /** Pill chips rendered above the message box (status / quick actions). */
  statusChips?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** When true, Enter prefers browse/suggest pick over sending chat. */
  browseActive?: boolean;
  onBrowseEnter?: () => boolean;
  onSuggestEnter?: () => boolean;
  onSuggestArrow?: (dir: "up" | "down") => void;
  onAskForce?: () => void;
  onComposerEscape?: () => void;
  inputRef?: Ref<HTMLInputElement | null>;
  /** Increment to force-send the current value to Intelligence. */
  sendRequestId?: number;
}) {
  const {
    activeAgentId,
    setActiveAgentId,
    setChatMode,
    openPanel,
    chatTarget,
    setChatTarget,
    dmConversations,
    focusedChatWindowId,
    openChatWindows,
    clearComposerDraft,
    emitDmIncomingMessage,
    refreshDmConversations,
  } = useIntelligence();
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const workStartedAt = useRef<number | null>(null);
  const [workedLabel, setWorkedLabel] = useState<string | null>(null);

  const focusedWindow = openChatWindows.find((w) => w.id === focusedChatWindowId);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (busy) {
      if (workStartedAt.current == null) workStartedAt.current = Date.now();
      setWorkedLabel("Working…");
      const id = window.setInterval(() => {
        const start = workStartedAt.current;
        if (start == null) return;
        const sec = Math.max(1, Math.round((Date.now() - start) / 1000));
        setWorkedLabel(`Worked for ${sec}s`);
      }, 1000);
      return () => window.clearInterval(id);
    }
    if (workStartedAt.current != null) {
      const sec = Math.max(1, Math.round((Date.now() - workStartedAt.current) / 1000));
      setWorkedLabel(`Worked for ${sec}s`);
      workStartedAt.current = null;
      const clearId = window.setTimeout(() => setWorkedLabel(null), 4000);
      return () => window.clearTimeout(clearId);
    }
    return undefined;
  }, [busy]);

  const postToConversation = useCallback(
    async (conversationId: string, text: string) => {
      const dir = await fetchDmDirectory();
      const cloud = dir.cloudChannels.find((c) => c.id === conversationId);
      const install = dir.installChannels.find((c) => c.id === conversationId);
      const privateConv = dmConversations.find((c) => c.id === conversationId);
      const isPublicChannel = Boolean(cloud || install);

      if (cloud && !dir.cloudLobbyHostedHere) {
        toast.message(
          "Cloud lobby posts from Local are not available yet. Use #local on this install, or open GodMode Cloud."
        );
        return false;
      }

      if (cloud || install) {
        const allowed = cloud
          ? dir.entitlement.ok
          : dir.entitlement.installLocalOk !== false;
        if (!allowed) {
          toast.message(
            cloud
              ? dir.entitlement.reason
              : "Sign in with a full account to post in #local."
          );
          return false;
        }
      } else if (!privateConv) {
        toast.message("Conversation not found on this install.");
        return false;
      }

      const res = await sendDmMessage(conversationId, { bodyText: text });
      emitDmIncomingMessage(res.message, conversationId);
      void refreshDmConversations();

      // @general / @local in a public channel also opens that channel agent's DM.
      if (isPublicChannel) {
        const handles = [
          ...text.matchAll(/@([a-z0-9_]{3,32})\b/gi),
        ].map((m) => m[1]!.toLowerCase());
        const channels = [...dir.installChannels, ...dir.cloudChannels];
        for (const handle of handles) {
          const ch = channels.find((c) => c.slug === handle);
          if (!ch?.agentId || !isChannelAgentId(ch.agentId)) continue;
          try {
            const dm = await ensureAgentDm(ch.agentId);
            setChatTarget({
              kind: "conversation",
              conversationId: dm.conversation.id,
            });
            setActiveAgentId(ch.agentId, { retainChatTarget: true });
            void refreshDmConversations();
            toast.message(`Opened DM with ${ch.displayTitle}`);
          } catch {
            /* mention still posted in-channel; DM open is best-effort */
          }
          break;
        }
      }
      return true;
    },
    [
      dmConversations,
      emitDmIncomingMessage,
      refreshDmConversations,
      setActiveAgentId,
      setChatTarget,
    ]
  );

  const send = useCallback(() => {
    const text = value.trim();
    if (!text || busy) return;

    if (chatTarget.kind === "conversation") {
      const conversationId = chatTarget.conversationId;
      setBusy(true);
      openPanel({ tab: "chat" });
      void (async () => {
        try {
          const ok = await postToConversation(conversationId, text);
          if (!ok) return;
          onValueChange("");
          clearComposerDraft(focusedChatWindowId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to send";
          toast.error(msg);
          setWorkedLabel(msg);
          window.setTimeout(() => setWorkedLabel(null), 4000);
        } finally {
          setBusy(false);
        }
      })();
      return;
    }

    const agentId =
      focusedWindow?.kind === "agent" && focusedWindow.agentId
        ? focusedWindow.agentId
        : chatTarget.kind === "agent"
          ? chatTarget.agentId
          : activeAgentId;

    // Channel agents are 1:1 DMs (same as Agents → #general / @general).
    if (isChannelAgentId(agentId)) {
      setBusy(true);
      openPanel({ tab: "chat" });
      void (async () => {
        try {
          const res = await ensureAgentDm(agentId);
          setChatTarget({
            kind: "conversation",
            conversationId: res.conversation.id,
          });
          setActiveAgentId(agentId, { retainChatTarget: true });
          const ok = await postToConversation(res.conversation.id, text);
          if (!ok) return;
          onValueChange("");
          clearComposerDraft(focusedChatWindowId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to send";
          toast.error(msg);
          setWorkedLabel(msg);
          window.setTimeout(() => setWorkedLabel(null), 4000);
        } finally {
          setBusy(false);
        }
      })();
      return;
    }

    onValueChange("");
    clearComposerDraft(focusedChatWindowId);

    // Agent replies stream in IntelligencePanel; Graph ether is the composer.
    openPanel({
      agentId,
      tab: "chat",
      prompt: text,
      autoSend: true,
    });
  }, [
    activeAgentId,
    busy,
    chatTarget,
    clearComposerDraft,
    focusedChatWindowId,
    focusedWindow,
    onValueChange,
    openPanel,
    postToConversation,
    setActiveAgentId,
    setChatTarget,
    value,
  ]);

  const sendRequestSeen = useRef(0);
  useEffect(() => {
    if (!sendRequestId || sendRequestId === sendRequestSeen.current) return;
    sendRequestSeen.current = sendRequestId;
    send();
  }, [sendRequestId, send]);

  const handlePrimaryAction = useCallback(() => {
    if (onSuggestEnter?.()) return;
    if (browseActive && onBrowseEnter?.()) return;
    send();
  }, [browseActive, onBrowseEnter, onSuggestEnter, send]);

  const handleAskForce = useCallback(() => {
    if (onAskForce) {
      onAskForce();
      return;
    }
    send();
  }, [onAskForce, send]);

  const toggleMic = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new Recognition();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = Array.from({ length: e.results.length })
        .map((_, i) => e.results[i][0].transcript)
        .join(" ");
      onValueChange(value ? `${value} ${transcript}` : transcript);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening, onValueChange, value]);

  const hasText = value.trim().length > 0;
  const speechAvailable = typeof window !== "undefined" && !!getSpeechRecognition();
  const focusChip = useGraphFocusChip();
  const FocusIcon = focusChip?.Icon;

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      {(statusChips || workedLabel || focusChip) && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-1.5"
          data-graph-action-chrome=""
        >
          {focusChip && FocusIcon ? (
            <span
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs shadow-sm backdrop-blur-sm",
                focusChip.mode === "replying"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/50 bg-card/80 text-muted-foreground"
              )}
              title={
                focusChip.mode === "replying"
                  ? `Replying to ${focusChip.label}`
                  : `Focused on ${focusChip.label}`
              }
            >
              <FocusIcon
                className="size-3.5 shrink-0"
                style={{ color: focusChip.accent }}
                aria-hidden
              />
              <span className="truncate">
                {focusChip.mode === "replying"
                  ? `Replying to ${focusChip.label}`
                  : `Focused on ${focusChip.label}`}
              </span>
            </span>
          ) : null}
          {workedLabel ? (
            <span className="inline-flex h-7 items-center rounded-full border border-border/50 bg-card/80 px-2.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              {workedLabel}
            </span>
          ) : null}
          {statusChips}
        </div>
      )}

      <div className="flex shrink-0" data-graph-action-chrome="">
        <InputGroup
          className={cn(
            "h-12 min-w-0 flex-1 rounded-full border-border/50 bg-card/85 shadow-sm backdrop-blur-md",
            "dark:bg-card/90",
            "has-[[data-slot=input-group-control]:focus-visible]:border-ring/60 has-[[data-slot=input-group-control]:focus-visible]:ring-2"
          )}
        >
          <InputGroupAddon align="inline-start" className="pl-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Add context"
                    className="size-8 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  />
                }
              >
                <PlusIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel>Compose</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    setChatMode("ask");
                    handleAskForce();
                  }}
                >
                  <SparklesIcon />
                  Ask Intelligence
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => openPanel({ tab: "chat" })}
                >
                  Open Intelligence panel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    onValueChange(value || "create ");
                  }}
                >
                  Type an action…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </InputGroupAddon>

          <InputGroupInput
            ref={inputRef}
            data-graph-ether-composer=""
            className="bg-transparent text-sm text-foreground/90 placeholder:text-muted-foreground/70"
            placeholder={placeholder}
            value={value}
            disabled={busy && !browseActive}
            aria-label="Search Graph, browse actions, or ask Intelligence"
            aria-autocomplete="list"
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onComposerEscape?.();
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                onSuggestArrow?.("down");
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                onSuggestArrow?.("up");
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.ctrlKey || e.metaKey) {
                  handleAskForce();
                  return;
                }
                handlePrimaryAction();
              }
            }}
          />

          <InputGroupAddon align="inline-end" className="gap-1 pr-1.5">
            {hasText ? (
              <Button
                type="button"
                size="icon-sm"
                variant="default"
                disabled={busy}
                aria-label={
                  browseActive ? "Select match or send" : "Send message"
                }
                onClick={handlePrimaryAction}
                className="size-8 rounded-full"
              >
                <ArrowUpIcon />
              </Button>
            ) : speechAvailable ? (
              <Button
                type="button"
                size="icon-sm"
                variant="secondary"
                aria-label={listening ? "Stop voice input" : "Voice input"}
                title="Voice input"
                onClick={toggleMic}
                className={cn(
                  "size-8 rounded-full bg-foreground text-background hover:bg-foreground/90",
                  listening && "ring-2 ring-destructive/60"
                )}
              >
                <MicIcon />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                variant="default"
                disabled={busy || !hasText}
                aria-label="Send message"
                onClick={handlePrimaryAction}
                className="size-8 rounded-full"
              >
                <ArrowUpIcon />
              </Button>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}
