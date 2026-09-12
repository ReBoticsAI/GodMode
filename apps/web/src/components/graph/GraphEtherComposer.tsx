import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SendIcon } from "lucide-react";
import { streamAiChat } from "@/api";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useIntelligence } from "@/lib/intelligence-context";
import { cn } from "@/lib/utils";

type EtherLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  streaming?: boolean;
};

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

/**
 * Transparent graph chatroom: full-height left ether log + faint composer.
 * Does not open the floating Chat window.
 * `composerTrailing` sits on the same row as the message box (theme, chat hide, etc.).
 */
export function GraphEtherComposer({
  className,
  composerTrailing,
}: {
  className?: string;
  composerTrailing?: ReactNode;
}) {
  const { activeAgentId } = useIntelligence();
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<EtherLine[]>([]);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");

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
          setLines((prev) =>
            prev.map((l) =>
              l.id === assistantId
                ? {
                    ...l,
                    role: "system",
                    text: err || "Something went wrong",
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
  }, [activeAgentId, busy, draft]);

  return (
    <div
      className={cn("flex min-h-0 w-full flex-1 flex-col gap-1.5", className)}
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 8%, black 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 8%, black 100%)",
      }}
    >
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

      <div className="flex shrink-0 items-center gap-2">
        <InputGroup className="h-9 min-w-0 flex-1 border-border/30 bg-transparent shadow-none dark:bg-transparent">
          <InputGroupInput
            className="bg-transparent text-sm text-foreground/90 placeholder:text-foreground/40"
            placeholder="Message Intelligence…"
            value={draft}
            disabled={busy}
            aria-label="Graph chat composer"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              size="icon-xs"
              variant="ghost"
              disabled={busy || !draft.trim()}
              aria-label="Send message"
              onClick={send}
            >
              <SendIcon className="opacity-70" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {composerTrailing ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {composerTrailing}
          </div>
        ) : null}
      </div>
    </div>
  );
}
