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
  ChevronDownIcon,
  MicIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { streamAiChat, readStoredTrialGreeting } from "@/api";
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
import {
  useIntelligence,
  type IntelligenceChatMode,
} from "@/lib/intelligence-context";
import { cn } from "@/lib/utils";

type EtherLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  streaming?: boolean;
};

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

const MODE_LABEL: Record<IntelligenceChatMode, string> = {
  agent: "Agent",
  plan: "Plan",
  ask: "Ask",
};

/**
 * Transparent graph chatroom: optional ether log + Cursor-style pill message box.
 * Host anchors the composer bottom-center; show/hide chat toggles the log only.
 *
 * One messagebox: search/filter Graph, browse actions, or ask Intelligence.
 * Enter activates a smart suggestion when provided; Ctrl+Enter always asks.
 */
export function GraphEtherComposer({
  className,
  statusChips,
  value,
  onValueChange,
  placeholder = "Ask Intelligence, or filter the Graph…",
  logOpen = true,
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
  /** When false, only the message box is shown (ether log hidden). */
  logOpen?: boolean;
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
  const { activeAgentId, chatMode, setChatMode, setPanelOpen } =
    useIntelligence();
  const [lines, setLines] = useState<EtherLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const linesRef = useRef(lines);
  const greetingSeeded = useRef(false);
  const workStartedAt = useRef<number | null>(null);
  const [workedLabel, setWorkedLabel] = useState<string | null>(null);
  linesRef.current = lines;

  useEffect(() => {
    if (greetingSeeded.current) return;
    const seedGreeting = (greeting: string) => {
      if (greetingSeeded.current || !greeting.trim()) return;
      greetingSeeded.current = true;
      setLines((prev) => {
        if (prev.some((l) => l.id === "trial-greeting")) return prev;
        return [
          {
            id: "trial-greeting",
            role: "assistant",
            text: greeting.trim(),
            at: Date.now(),
          },
          ...prev,
        ];
      });
    };
    const stored = readStoredTrialGreeting();
    if (stored?.greeting) seedGreeting(stored.greeting);
    const onGreeting = (ev: Event) => {
      const detail = (ev as CustomEvent<{ greeting?: string }>).detail;
      if (detail?.greeting) seedGreeting(detail.greeting);
    };
    window.addEventListener("godmode:trial-greeting", onGreeting);
    return () => window.removeEventListener("godmode:trial-greeting", onGreeting);
  }, []);

  useEffect(() => {
    if (!logOpen) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, logOpen]);

  useEffect(() => {
    return () => {
      abortRef.current?.();
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

  const send = useCallback(() => {
    const text = value.trim();
    if (!text || busy) return;
    onValueChange("");

    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;
    const history = linesRef.current
      .filter((l) => l.role === "user" || l.role === "assistant")
      .filter((l) => l.text.trim().length > 0)
      .map((l) => ({ role: l.role, content: l.text }));

    setLines((prev) => [
      ...prev,
      { id: userId, role: "user", text, at: Date.now() },
      {
        id: assistantId,
        role: "assistant",
        text: "",
        at: Date.now(),
        streaming: true,
      },
    ]);
    setBusy(true);

    abortRef.current?.();
    abortRef.current = streamAiChat(
      {
        chatId: chatIdRef.current ?? undefined,
        message: text,
        history,
        agentId: activeAgentId,
      },
      {
        onChatId: (id) => {
          chatIdRef.current = id;
        },
        onToken: (chunk) => {
          setLines((prev) =>
            prev.map((l) =>
              l.id === assistantId ? { ...l, text: l.text + chunk } : l
            )
          );
        },
        onDone: (data) => {
          setLines((prev) =>
            prev.map((l) =>
              l.id === assistantId
                ? {
                    ...l,
                    text: l.text || data.answer || data.content || "",
                    streaming: false,
                  }
                : l
            )
          );
          setBusy(false);
          abortRef.current = null;
        },
        onError: (err) => {
          const raw = (err || "").trim();
          const lower = raw.toLowerCase();
          const text =
            lower.includes("authentication required") ||
            lower.includes("unauthorized") ||
            lower.includes("401")
              ? "Sign in to chat with GodMode Inference. Open Auth (?auth=1) or use the account menu, then send again."
              : raw || "Something went wrong";
          setLines((prev) =>
            prev.map((l) =>
              l.id === assistantId
                ? {
                    ...l,
                    role: "system",
                    text,
                    streaming: false,
                  }
                : l
            )
          );
          setBusy(false);
          abortRef.current = null;
        },
      }
    );
  }, [activeAgentId, busy, onValueChange, value]);

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
  const autoLabel = chatMode === "agent" ? "Auto" : MODE_LABEL[chatMode];

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col gap-2",
        logOpen && "min-h-[12rem] flex-1",
        className
      )}
      style={
        logOpen
          ? {
              maskImage:
                "linear-gradient(to bottom, transparent 0%, black 8%, black 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, black 8%, black 100%)",
            }
          : undefined
      }
    >
      {logOpen ? (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
          <div className="flex min-h-full flex-col justify-end gap-0.5 py-1">
            {lines.length === 0 ? (
              <p className="text-[11px] text-foreground/35">
                Messages appear here in the graph.
              </p>
            ) : null}
            {lines.map((l) => (
              <p
                key={l.id}
                className={cn(
                  "text-[12px] leading-snug",
                  l.role === "system"
                    ? "text-destructive/80"
                    : "text-foreground/85"
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
        </div>
      ) : null}

      {(statusChips || workedLabel) && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-1.5"
          data-graph-action-chrome=""
        >
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
                <DropdownMenuItem onClick={() => setPanelOpen(true)}>
                  Open Intelligence panel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    onValueChange(value || "create ");
                    // Focus handled by input; parent smart-suggest filters actions.
                  }}
                >
                  Type an action…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </InputGroupAddon>

          <InputGroupInput
            ref={inputRef}
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
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-0.5 rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Intelligence mode"
                    aria-label="Intelligence mode"
                  />
                }
              >
                {autoLabel}
                <ChevronDownIcon className="size-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Mode</DropdownMenuLabel>
                {(
                  [
                    ["agent", "Auto (Agent)"],
                    ["plan", "Plan"],
                    ["ask", "Ask"],
                  ] as const
                ).map(([mode, label]) => (
                  <DropdownMenuItem
                    key={mode}
                    onClick={() => setChatMode(mode)}
                  >
                    {label}
                    {chatMode === mode ? (
                      <span className="ml-auto text-xs text-primary">●</span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

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
