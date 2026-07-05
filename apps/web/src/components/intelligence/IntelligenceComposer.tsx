import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowUpIcon,
  AtSignIcon,
  CameraIcon,
  ChevronDownIcon,
  FileTextIcon,
  ImageIcon,
  MicIcon,
  PlusIcon,
  BotIcon,
  FileCodeIcon,
  XIcon,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { clampComposerWidth, useIntelligence, type IntelligenceChatMode, type ToolAutonomyLevel } from "@/lib/intelligence-context";
import { useAiStatus } from "@/hooks/use-ai-status";
import {
  fetchAiCommands,
  fetchAiModels,
  fetchCursorModels,
  fetchCursorStatus,
  applyCursorToIntelligence,
  startAiModel,
  uploadDmFile,
  type AiChatCommand,
  type AiModel,
  type DmAttachmentInput,
} from "@/api";
import {
  filterSlashCommands,
  processSlashCommand,
} from "@/lib/chat-slash-commands";
import type { MentionSource } from "@/lib/intelligence-context";

export interface ComposerSubmit {
  text: string;
  images: string[];
  mentionIds: string[];
  dmAttachments?: DmAttachmentInput[];
}

interface IntelligenceComposerProps {
  variant: "footer" | "panel";
  value: string;
  onChange: (value: string) => void;
  onSubmit: (payload: ComposerSubmit) => void;
  disabled?: boolean;
  busy?: boolean;
  onStop?: () => void;
  /** When true, image uploads go through /api/dm/uploads (blob store). */
  dmMode?: boolean;
  /** Overrides the input placeholder (e.g. "Ask anything…"). */
  placeholder?: string;
  onNewChat?: () => void;
  onOpenRules?: () => void;
  onMemoryAdd?: (text: string) => Promise<void>;
}

const MENTION_CATEGORIES = [
  "Page",
  "Trading",
  "Artifacts",
  "Playbooks",
  "Skills",
  "Rules",
  "Memory",
  "Agents",
  "Files",
  "Folders",
] as const;

type TypeaheadState = {
  kind: "mention" | "slash";
  query: string;
  start: number;
  end: number;
};

function detectTypeahead(value: string, cursor: number): TypeaheadState | null {
  const before = value.slice(0, cursor);
  const slashMatch = before.match(/(?:^|\n)\/([\w-]*)$/);
  if (slashMatch && slashMatch.index != null) {
    const query = slashMatch[1] ?? "";
    const start = slashMatch.index + (slashMatch[0].length - query.length - 1);
    return { kind: "slash", query, start, end: cursor };
  }
  const atMatch = before.match(/@([^\n@]*)$/);
  if (atMatch && atMatch.index != null) {
    return {
      kind: "mention",
      query: (atMatch[1] ?? "").trim().toLowerCase(),
      start: atMatch.index,
      end: cursor,
    };
  }
  return null;
}

function groupMentionSources(sources: MentionSource[]): Map<string, MentionSource[]> {
  const map = new Map<string, MentionSource[]>();
  for (const src of sources) {
    const cat = src.category ?? "Other";
    const list = map.get(cat) ?? [];
    list.push(src);
    map.set(cat, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }
  return map;
}

function filterMentionSources(sources: MentionSource[], query: string): MentionSource[] {
  if (!query) return sources;
  return sources.filter(
    (s) =>
      s.label.toLowerCase().includes(query) ||
      (s.category ?? "").toLowerCase().includes(query) ||
      s.id.toLowerCase().includes(query)
  );
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function IntelligenceComposer({
  variant,
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  onStop,
  dmMode,
  placeholder,
  onNewChat,
  onOpenRules,
  onMemoryAdd,
}: IntelligenceComposerProps) {
  const {
    breadcrumb,
    mentionSources,
    artifactMentions,
    removeArtifactMention,
    captureScreenshot,
    setPanelOpen,
    panelOpen,
    composerWidth,
    setComposerWidth,
    chatMode,
    setChatMode,
    toolAutonomy,
    setToolAutonomy,
  } = useIntelligence();
  const { status, refresh } = useAiStatus();

  const [models, setModels] = useState<AiModel[]>([]);
  const [cursorModels, setCursorModels] = useState<Array<{ id: string; label: string }>>([]);
  const [cursorConnected, setCursorConnected] = useState(false);
  const [slashCommands, setSlashCommands] = useState<AiChatCommand[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [dmAttachments, setDmAttachments] = useState<DmAttachmentInput[]>([]);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [typeahead, setTypeahead] = useState<TypeaheadState | null>(null);
  const [typeaheadIndex, setTypeaheadIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isPanel = variant === "panel";

  // Right-edge drag handle on the footer pill resizes the shared composer width
  // (and, in lockstep, the floating modal which renders at the same width).
  const handleWidthResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = composerWidth;
    const left = formRef.current?.getBoundingClientRect().left ?? 0;
    const onMove = (ev: PointerEvent) => {
      const available = window.innerWidth - left - 24;
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

  useEffect(() => {
    if (!isPanel || dmMode) return;
    fetchAiModels()
      .then((r) => setModels(r.models))
      .catch(() => setModels([]));
    fetchAiCommands()
      .then((r) => setSlashCommands(r.commands))
      .catch(() => setSlashCommands([]));
    fetchCursorStatus()
      .then((s) => {
        setCursorConnected(s.connected);
        if (s.connected) {
          return fetchCursorModels().then((r) => setCursorModels(r.models));
        }
        return undefined;
      })
      .catch(() => {
        setCursorConnected(false);
        setCursorModels([]);
      });
  }, [isPanel, dmMode]);

  const mentionIndex = useMemo(() => {
    const skills = new Map<string, string>();
    const agents = new Map<string, string>();
    for (const src of mentionSources) {
      if (src.id.startsWith("skill:")) {
        const id = src.id.slice("skill:".length);
        skills.set(id, id);
        skills.set(src.label.toLowerCase(), id);
      }
      if (src.id.startsWith("agent:")) {
        const id = src.id.slice("agent:".length);
        agents.set(id, id);
        agents.set(src.label.toLowerCase(), id);
      }
    }
    return { skills, agents };
  }, [mentionSources]);

  const groupedSources = useMemo(
    () => groupMentionSources(mentionSources),
    [mentionSources]
  );

  const typeaheadItems = useMemo(() => {
    if (!typeahead) return [];
    if (typeahead.kind === "slash") {
      return filterSlashCommands(slashCommands, typeahead.query);
    }
    return filterMentionSources(mentionSources, typeahead.query);
  }, [typeahead, slashCommands, mentionSources]);

  useEffect(() => {
    setTypeaheadIndex(0);
  }, [typeahead?.query, typeahead?.kind]);

  const applyTypeaheadMention = useCallback(
    (src: MentionSource) => {
      if (!typeahead) return;
      setMentionIds((prev) =>
        prev.includes(src.id) ? prev : [...prev, src.id]
      );
      const next = value.slice(0, typeahead.start) + value.slice(typeahead.end);
      onChange(next);
      setTypeahead(null);
      textareaRef.current?.focus();
    },
    [typeahead, value, onChange]
  );

  const applyTypeaheadSlash = useCallback(
    (cmd: AiChatCommand) => {
      if (!typeahead) return;
      const insertion = cmd.usage.split(/\s/)[0] ?? cmd.usage;
      const next = value.slice(0, typeahead.start) + insertion + " " + value.slice(typeahead.end);
      onChange(next);
      setTypeahead(null);
      textareaRef.current?.focus();
    },
    [typeahead, value, onChange]
  );

  const syncTypeahead = useCallback(
    (nextValue: string, cursor: number) => {
      setTypeahead(detectTypeahead(nextValue, cursor));
    },
    []
  );

  const currentPageLabel = breadcrumb[breadcrumb.length - 1] ?? "Platform";

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (disabled) return;
    setTypeahead(null);

    let text = value.trim();
    let nextMentionIds = [...mentionIds];

    if (!dmMode && text.startsWith("/")) {
      const slash = processSlashCommand(text, slashCommands, mentionIndex);
      if (slash?.kind === "client") {
        if (slash.action === "clear") onNewChat?.();
        if (slash.action === "screenshot") await handleScreenshot();
        if (slash.action === "open-rules") onOpenRules?.();
        if (slash.action === "start-model" && slash.modelName) {
          const match =
            models.find((m) => m.id === slash.modelName) ??
            models.find((m) =>
              m.name.toLowerCase().includes(slash.modelName!.toLowerCase())
            );
          if (match) await handleModelSelect(match);
        }
        onChange("");
        return;
      }
      if (slash?.kind === "memory-add") {
        if (onMemoryAdd) await onMemoryAdd(slash.text);
        onChange("");
        return;
      }
      if (slash?.kind === "expand") {
        text = slash.message;
        nextMentionIds = [...new Set([...nextMentionIds, ...slash.mentionIds])];
      }
      if (slash?.kind === "not-found") {
        toast.error(`Unknown or incomplete command: ${slash.command}`);
        return;
      }
    }

    if (
      !text &&
      images.length === 0 &&
      dmAttachments.length === 0 &&
      artifactMentions.length === 0 &&
      nextMentionIds.length === 0
    ) {
      return;
    }

    onSubmit({
      text,
      images: dmMode ? [] : images,
      mentionIds: dmMode ? [] : nextMentionIds,
      dmAttachments: dmMode ? dmAttachments : undefined,
    });
    onChange("");
    setImages([]);
    setDmAttachments([]);
    setMentionIds([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (typeahead && typeaheadItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setTypeaheadIndex((i) => (i + 1) % typeaheadItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setTypeaheadIndex((i) => (i - 1 + typeaheadItems.length) % typeaheadItems.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTypeahead(null);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const item = typeaheadItems[typeaheadIndex];
        if (typeahead.kind === "mention" && "resolve" in item) {
          applyTypeaheadMention(item as MentionSource);
        } else if (typeahead.kind === "slash" && "usage" in item) {
          applyTypeaheadSlash(item as AiChatCommand);
        }
        return;
      }
      if (e.key === "Tab" && typeaheadItems.length > 0) {
        e.preventDefault();
        const item = typeaheadItems[typeaheadIndex];
        if (typeahead.kind === "mention" && "resolve" in item) {
          applyTypeaheadMention(item as MentionSource);
        } else if (typeahead.kind === "slash" && "usage" in item) {
          applyTypeaheadSlash(item as AiChatCommand);
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const addImagesFromFiles = (files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    if (dmMode) {
      void (async () => {
        for (const file of imageFiles) {
          try {
            const blob = await uploadDmFile(file);
            const kind = blob.mime.startsWith("image/") ? "image" : "file";
            setDmAttachments((prev) => [
              ...prev,
              {
                kind,
                blobId: blob.id,
                mime: blob.mime,
                size: blob.size,
              },
            ]);
            if (kind === "image") {
              setImages((prev) => [...prev, blob.href]);
            }
          } catch {
            /* ignore */
          }
        }
      })();
      return;
    }
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const items = e.clipboardData?.items;
    if (!items?.length) return;

    const pasted: File[] = [];
    for (const item of items) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) pasted.push(file);
    }
    if (!pasted.length) return;

    e.preventDefault();
    const dt = new DataTransfer();
    for (const file of pasted) dt.items.add(file);
    addImagesFromFiles(dt.files);
  };

  const handleScreenshot = async () => {
    if (dmMode) return;
    const shot = await captureScreenshot();
    if (shot) setImages((prev) => [...prev, shot]);
  };

  const toggleMention = (id: string) => {
    setMentionIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const toggleMic = () => {
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
      onChange(value ? `${value} ${transcript}` : transcript);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const handleModelSelect = async (model: AiModel) => {
    try {
      await startAiModel(model.path);
      refresh();
    } catch {
      /* surfaced via status */
    }
  };

  const handleCursorModelSelect = async (modelId: string) => {
    try {
      await applyCursorToIntelligence(modelId);
      toast.success(`Intelligence using Cursor model: ${modelId}`);
    } catch {
      toast.error("Failed to switch to Cursor model");
    }
  };

  const modeLabel: Record<IntelligenceChatMode, string> = {
    agent: "Agent",
    plan: "Plan",
    ask: "Ask",
  };

  const running = status?.state === "running";
  const modelLabel = running
    ? status?.modelName?.replace(/\.gguf$/i, "") ?? "Model"
    : status?.state === "starting"
      ? "Starting…"
      : "Auto";

  // Footer launcher: compact pill in the app footer; submit opens the floating panel.
  if (!isPanel) {
    return (
      <form
        ref={formRef}
        onSubmit={(e) => void handleSubmit(e)}
        role="search"
        aria-label="Intelligence chat"
        className={cn(
          "relative flex h-7 w-full min-w-0 max-w-full items-center gap-1.5",
          "rounded-full border border-border/60 bg-card/70 px-1",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => setPanelOpen(true)}
          className="size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground [&_svg]:size-3"
          aria-label="Open Intelligence"
        >
          <PlusIcon />
        </Button>

        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
          title="Intelligence assistant"
        >
          <BotIcon className="size-3 text-amber-400" />
          Intelligence
        </span>

        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={placeholder ?? "Ask Intelligence anything…"}
          aria-label="Ask Intelligence"
          className={cn(
            "h-6 min-w-0 flex-1 border-0 bg-transparent px-1 py-0 text-xs outline-none",
            "placeholder:text-muted-foreground/70"
          )}
        />

        <span
          className="hidden shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-flex"
          title="Toggle panel (Ctrl/Cmd+L)"
        >
          {panelOpen ? "Open" : "Ctrl L"}
        </span>

        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label="Open chat"
          className="size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground [&_svg]:size-3"
        >
          <ArrowUpIcon />
        </Button>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Intelligence width"
          title="Drag to resize"
          onPointerDown={handleWidthResize}
          className={cn(
            "absolute -right-1 top-1/2 z-10 h-5 w-2 -translate-y-1/2 cursor-ew-resize",
            "after:absolute after:left-1/2 after:top-1/2 after:h-3.5 after:w-0.5",
            "after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full",
            "after:bg-border/70 after:transition-colors hover:after:bg-foreground/50"
          )}
        />
      </form>
    );
  }

  // Panel composer: full Cursor-style input with context chips + toolbar.
  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/60 p-2"
    >
      {!dmMode && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            <AtSignIcon className="size-3" />
            {currentPageLabel}
            <span className="text-muted-foreground/60">(current page)</span>
          </span>
          {mentionIds.map((id) => {
            const src = mentionSources.find((s) => s.id === id);
            if (!src) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] text-foreground"
              >
                {src.label}
                <button
                  type="button"
                  onClick={() => toggleMention(id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            );
          })}
          {artifactMentions.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-foreground"
              title="Artifact attached — full content is sent with your message"
            >
              <FileTextIcon className="size-3 shrink-0 text-emerald-600" />
              {a.name}
              <button
                type="button"
                onClick={() => removeArtifactMention(a.id)}
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-border/60 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <AtSignIcon className="size-3" />
                  Add context
                </button>
              }
            />
            <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
              <DropdownMenuLabel>Mention context</DropdownMenuLabel>
              {mentionSources.length === 0 && (
                <DropdownMenuItem disabled>Loading agent context…</DropdownMenuItem>
              )}
              {MENTION_CATEGORIES.map((cat) => {
                const items = groupedSources.get(cat);
                if (!items?.length) return null;
                return (
                  <div key={cat}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {cat}
                    </DropdownMenuLabel>
                    {items.map((src) => (
                      <DropdownMenuItem
                        key={src.id}
                        onClick={() => toggleMention(src.id)}
                      >
                        <AtSignIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{src.label}</span>
                        {mentionIds.includes(src.id) && (
                          <span className="ml-auto text-xs text-primary">added</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </div>
                );
              })}
              {[...groupedSources.entries()]
                .filter(([cat]) => !MENTION_CATEGORIES.includes(cat as (typeof MENTION_CATEGORIES)[number]))
                .map(([cat, items]) => (
                  <div key={cat}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {cat}
                    </DropdownMenuLabel>
                    {items.map((src) => (
                      <DropdownMenuItem
                        key={src.id}
                        onClick={() => toggleMention(src.id)}
                      >
                        <AtSignIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{src.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((img, i) => (
            <div
              key={i}
              className="relative size-12 overflow-hidden rounded-md border border-border/60"
            >
              <img src={img} alt="attachment" className="size-full object-cover" />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        {typeahead && typeaheadItems.length > 0 && (
          <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border/70 bg-popover p-1 shadow-md">
            {typeahead.kind === "slash" ? (
              (typeaheadItems as AiChatCommand[]).map((cmd, i) => (
                <button
                  key={cmd.name}
                  type="button"
                  className={cn(
                    "flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs",
                    i === typeaheadIndex ? "bg-muted" : "hover:bg-muted/60"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyTypeaheadSlash(cmd);
                  }}
                >
                  <code className="font-medium">{cmd.usage}</code>
                  <span className="text-muted-foreground">{cmd.description}</span>
                </button>
              ))
            ) : (
              (typeaheadItems as MentionSource[]).map((src, i) => (
                <button
                  key={src.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                    i === typeaheadIndex ? "bg-muted" : "hover:bg-muted/60"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyTypeaheadMention(src);
                  }}
                >
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                    {src.category ?? "Context"}
                  </span>
                  <span className="truncate">{src.label}</span>
                </button>
              ))
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            syncTypeahead(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onClick={(e) =>
            syncTypeahead(
              e.currentTarget.value,
              e.currentTarget.selectionStart ?? e.currentTarget.value.length
            )
          }
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            placeholder ??
            "Ask Intelligence anything…  (@ context, / commands, Enter to send)"
          }
          rows={2}
          className={cn(
            "max-h-40 min-h-10 w-full resize-none border-0 bg-transparent px-1 text-sm outline-none",
            "placeholder:text-muted-foreground/60"
          )}
        />
      </div>

      <div className="flex items-center gap-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => addImagesFromFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Attach image"
          title="Attach image (or paste from clipboard)"
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon />
        </Button>
        {!dmMode && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Screenshot current page"
            title="Attach screenshot of current page"
            onClick={handleScreenshot}
          >
            <CameraIcon />
          </Button>
        )}

        {!dmMode && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  title="Chat mode"
                >
                  {modeLabel[chatMode]}
                  <ChevronDownIcon className="size-3" />
                </button>
              }
            />
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel>Mode</DropdownMenuLabel>
              {(["agent", "plan", "ask"] as IntelligenceChatMode[]).map((m) => (
                <DropdownMenuItem key={m} onClick={() => setChatMode(m)}>
                  {modeLabel[m]}
                  {chatMode === m && (
                    <span className="ml-auto text-xs text-primary">●</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {!dmMode && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="ml-1 inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  title="Model"
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      running
                        ? "bg-emerald-500"
                        : status?.state === "starting"
                          ? "bg-amber-500"
                          : "bg-muted-foreground/60"
                    )}
                  />
                  {modelLabel}
                  <ChevronDownIcon className="size-3" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Local models</DropdownMenuLabel>
              {models.length === 0 && (
                <DropdownMenuItem disabled>No models found</DropdownMenuItem>
              )}
              {models.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => handleModelSelect(m)}>
                  <span className="truncate">{m.name.replace(/\.gguf$/i, "")}</span>
                  {m.isMultimodal && (
                    <ImageIcon className="ml-auto size-3 text-muted-foreground" />
                  )}
                  {status?.modelPath === m.path && running && (
                    <span className="ml-1 text-xs text-emerald-500">●</span>
                  )}
                </DropdownMenuItem>
              ))}
              {cursorConnected && cursorModels.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Cursor subscription</DropdownMenuLabel>
                  {cursorModels.map((m) => (
                    <DropdownMenuItem key={m.id} onClick={() => handleCursorModelSelect(m.id)}>
                      <FileCodeIcon className="size-3 shrink-0 text-sky-500" />
                      <span className="truncate">{m.label || m.id}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled className="text-[11px]">
                Manage in the Builder tab
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {!dmMode && variant === "panel" && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                  title="Auto-run tools"
                >
                  Auto: {toolAutonomy}
                  <ChevronDownIcon className="size-3" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Auto-run tools</DropdownMenuLabel>
              {(
                [
                  ["off", "Off — confirm writes"],
                  ["writes", "Writes — auto edit/terminal"],
                  ["full", "Full — auto all safe tools"],
                ] as const
              ).map(([level, label]) => (
                <DropdownMenuItem
                  key={level}
                  onClick={() => setToolAutonomy(level as ToolAutonomyLevel)}
                >
                  {label}
                  {toolAutonomy === level && (
                    <span className="ml-auto text-xs text-primary">●</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="ml-auto flex items-center gap-1">
          {getSpeechRecognition() && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Voice input"
              title="Voice input"
              onClick={toggleMic}
              className={cn(listening && "text-red-500")}
            >
              <MicIcon />
            </Button>
          )}
          {busy ? (
            <Button
              type="button"
              size="icon-xs"
              variant="secondary"
              aria-label="Stop"
              onClick={onStop}
              className="rounded-full"
            >
              <span className="size-2 rounded-[1px] bg-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-xs"
              aria-label="Send"
              disabled={
                disabled ||
                (!value.trim() && images.length === 0 && dmAttachments.length === 0)
              }
              className="rounded-full"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
