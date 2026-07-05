import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  ExternalLinkIcon,
  Loader2Icon,
  ShieldAlertIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useIntelligence } from "@/lib/intelligence-context";
import { Markdown } from "./Markdown";
import {
  prettifyToolName,
  displayTodoItems,
  type KanbanTodoCard,
  type MsgPart,
  type TodoItem,
} from "./chat-parts";

/** Live-updating "Thought for Ns" reasoning block (Cursor-style). */
function ThinkingPart({
  text,
  startedAt,
  endedAt,
}: {
  text: string;
  startedAt: number;
  endedAt?: number;
}) {
  const active = endedAt == null;
  const [open, setOpen] = useState(active);
  const [, force] = useState(0);
  const wasActive = useRef(active);

  // Tick while actively thinking so the timer counts up.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);

  // Auto-collapse once reasoning finishes (only on the active -> done edge).
  useEffect(() => {
    if (wasActive.current && !active) setOpen(false);
    wasActive.current = active;
  }, [active]);

  const seconds = Math.max(
    0,
    Math.round(((endedAt ?? Date.now()) - startedAt) / 1000)
  );
  const label = active
    ? `Thinking${seconds > 0 ? ` ${seconds}s` : "…"}`
    : `Thought for ${seconds}s`;

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDownIcon
          className={cn("size-3 transition-transform", !open && "-rotate-90")}
        />
        <span className={cn(active && "animate-pulse")}>{label}</span>
      </button>
      {open && (
        <div className="mt-1 border-l-2 border-border/60 pl-3 text-xs text-muted-foreground [&_*]:text-muted-foreground">
          <Markdown content={text} />
        </div>
      )}
    </div>
  );
}

const TODO_ICON: Record<TodoItem["status"], React.ReactNode> = {
  completed: <CheckIcon className="size-3.5 text-emerald-500" />,
  in_progress: (
    <Loader2Icon className="size-3.5 animate-spin text-sky-500" />
  ),
  cancelled: <XIcon className="size-3.5 text-muted-foreground" />,
  pending: <CircleIcon className="size-3 text-muted-foreground/60" />,
};

/** Cursor-style inline checklist that evolves as the agent updates todos. */
function TodosPart({
  items,
  kanbanCards,
}: {
  items: TodoItem[];
  kanbanCards?: KanbanTodoCard[];
}) {
  const display = displayTodoItems(items, kanbanCards);
  if (!display.length) return null;
  const done = display.filter((t) => t.status === "completed").length;
  return (
    <div className="my-1.5 rounded-lg border border-border/60 bg-muted/20 p-2">
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
        <span>Todos</span>
        <span className="tabular-nums">
          {done}/{display.length}
        </span>
      </div>
      <ul className="space-y-0.5">
        {display.map((t, i) => (
          <li
            key={t.id ?? i}
            className="flex items-start gap-1.5 text-xs leading-relaxed"
          >
            <span className="mt-0.5 shrink-0">{TODO_ICON[t.status]}</span>
            <span
              className={cn(
                t.status === "completed" && "text-muted-foreground line-through",
                t.status === "cancelled" &&
                  "text-muted-foreground/60 line-through",
                t.status === "in_progress" && "text-foreground"
              )}
            >
              {t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusGlyph(status: string) {
  if (status === "awaiting_confirm")
    return <ShieldAlertIcon className="size-3.5 text-amber-500" />;
  if (status === "running")
    return <Loader2Icon className="size-3.5 animate-spin text-sky-500" />;
  if (status === "done")
    return <CheckIcon className="size-3.5 text-emerald-500" />;
  if (status === "error" || status === "denied")
    return <XIcon className="size-3.5 text-red-500" />;
  return <TerminalIcon className="size-3.5 text-muted-foreground" />;
}

function ToolConfirmBody({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}) {
  if (name === "run_terminal") {
    return (
      <div className="space-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">cwd: </span>
          <code className="rounded bg-background/60 px-1">
            {String(args.cwd ?? ".")}
          </code>
        </div>
        <pre className="max-h-32 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px] whitespace-pre-wrap">
          {String(args.command ?? "")}
        </pre>
      </div>
    );
  }
  if (name === "edit_file" || name === "write_file" || name === "apply_patch") {
    return (
      <div className="space-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">path: </span>
          <code className="rounded bg-background/60 px-1">
            {String(args.path ?? "")}
          </code>
        </div>
        {name === "edit_file" ? (
          <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px] whitespace-pre-wrap">
            {`--- old\n${String(args.old_string ?? "").slice(0, 1200)}\n\n+++ new\n${String(args.new_string ?? "").slice(0, 1200)}`}
          </pre>
        ) : name === "apply_patch" ? (
          <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px] whitespace-pre-wrap">
            {String(args.patch ?? "").slice(0, 2000)}
          </pre>
        ) : (
          <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px] whitespace-pre-wrap">
            {String(args.content ?? "").slice(0, 2000)}
          </pre>
        )}
      </div>
    );
  }
  return (
    <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px]">
      {JSON.stringify(args, null, 2)}
    </pre>
  );
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (!keys.length) return "";
  const primary =
    args.id ??
    args.label ??
    args.name ??
    args.prompt ??
    args.title ??
    args[keys[0]];
  const s = typeof primary === "string" ? primary : JSON.stringify(primary);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** Collapsible tool-call card: header w/ status, expandable args + result. */
function ToolPart({
  id,
  name,
  args,
  status,
  result,
  startedAt,
  endedAt,
  terminalStream,
  onApprove,
  onDeny,
}: Extract<MsgPart, { kind: "tool" }> & {
  onApprove?: (toolCallId: string) => void;
  onDeny?: (toolCallId: string) => void;
}) {
  const [open, setOpen] = useState(status === "awaiting_confirm");
  const { openArtifactViewer } = useIntelligence();
  const confirmRef = useRef<HTMLDivElement>(null);
  const argSummary = summarizeArgs(args);
  const seconds =
    endedAt != null ? ((endedAt - startedAt) / 1000).toFixed(1) : null;
  const resultText =
    result == null
      ? ""
      : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
  const savedArtifact =
    name === "save_artifact" &&
    status === "done" &&
    result &&
    typeof result === "object" &&
    "id" in result
      ? (result as { id: string; name?: string })
      : null;

  useEffect(() => {
    if (status !== "awaiting_confirm") return;
    setOpen(true);
    confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [status]);

  const awaiting = status === "awaiting_confirm";

  return (
    <div
      ref={confirmRef}
      data-tool-confirm={awaiting ? id : undefined}
      className={cn(
        "my-1 overflow-hidden rounded-lg border bg-muted/20",
        awaiting && "border-amber-500/50 ring-1 ring-amber-500/20"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-muted/40"
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="shrink-0">{statusGlyph(status)}</span>
        <span className="font-medium text-foreground">
          {prettifyToolName(name)}
        </span>
        {awaiting && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            Approval required
          </span>
        )}
        {argSummary && !awaiting && (
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {argSummary}
          </span>
        )}
        {seconds && (
          <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">
            {seconds}s
          </span>
        )}
      </button>
      {awaiting && (
        <div className="space-y-2 border-t border-amber-500/20 bg-amber-500/5 px-2 py-2">
          <p className="text-xs text-muted-foreground">
            The agent is paused until you approve or deny this action.
          </p>
          <ToolConfirmBody name={name} args={args} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onDeny?.(id)}
            >
              Deny
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onApprove?.(id)}
            >
              Approve
            </Button>
          </div>
        </div>
      )}
      {savedArtifact && (
        <div className="border-t border-border/40 px-2 py-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-full justify-start gap-1.5 text-xs"
            onClick={() =>
              openArtifactViewer({
                id: savedArtifact.id,
                name: savedArtifact.name ?? String(args.name ?? "artifact"),
              })
            }
          >
            <ExternalLinkIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              Open {savedArtifact.name ?? String(args.name ?? "artifact")}
            </span>
          </Button>
        </div>
      )}
      {open && (
        <div className="space-y-1.5 border-t border-border/40 px-2 py-1.5">
          {name === "read_file" && args.path != null ? (
            <div className="text-[10px] text-muted-foreground">
              Read <code className="rounded bg-background/60 px-1">{String(args.path)}</code>
              {args.offset != null ? ` from line ${String(args.offset)}` : null}
            </div>
          ) : null}
          {name === "run_terminal" || terminalStream ? (
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Terminal
                {result != null &&
                typeof result === "object" &&
                "exitCode" in result ? (
                  <span className="ml-2 normal-case">
                    exit {(result as { exitCode: number | null }).exitCode ?? "?"}
                  </span>
                ) : null}
              </div>
              <pre className="max-h-36 overflow-auto rounded bg-zinc-950 p-1.5 font-mono text-[10px] leading-relaxed text-zinc-100">
                {terminalStream ||
                  (result != null &&
                  typeof result === "object" &&
                  "stdout" in result
                    ? String((result as { stdout?: string }).stdout ?? "")
                    : "")}
              </pre>
            </div>
          ) : null}
          {(() => {
            const diff =
              result != null &&
              typeof result === "object" &&
              "diff" in result &&
              typeof (result as { diff?: string }).diff === "string"
                ? (result as { diff: string }).diff
                : "";
            if (
              !diff ||
              (name !== "edit_file" &&
                name !== "write_file" &&
                name !== "apply_patch")
            ) {
              return null;
            }
            return (
              <div>
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Diff
                </div>
                <pre className="max-h-48 overflow-auto rounded bg-background/60 p-1.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                  {diff.slice(0, 4000)}
                </pre>
              </div>
            );
          })()}
          <details className="text-[10px]">
            <summary className="cursor-pointer text-muted-foreground">Debug JSON</summary>
            <div className="mt-1 space-y-1.5">
              <pre className="max-h-32 overflow-auto rounded bg-background/60 p-1.5 font-mono leading-relaxed">
                {JSON.stringify(args, null, 2)}
              </pre>
              {resultText && (
                <pre
                  className={cn(
                    "max-h-32 overflow-auto rounded bg-background/60 p-1.5 font-mono leading-relaxed",
                    (status === "error" || status === "denied") && "text-red-400"
                  )}
                >
                  {resultText}
                </pre>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/** Renders an assistant turn's ordered parts (thinking, tools, todos, text). */
export function ChatTurn({
  parts,
  kanbanTodoCards,
  onApproveTool,
  onDenyTool,
}: {
  parts: MsgPart[];
  kanbanTodoCards?: KanbanTodoCard[];
  onApproveTool?: (toolCallId: string) => void;
  onDenyTool?: (toolCallId: string) => void;
}) {
  return (
    <div className="flex flex-col">
      {parts.map((p, i) => {
        if (p.kind === "thinking")
          return (
            <ThinkingPart
              key={i}
              text={p.text}
              startedAt={p.startedAt}
              endedAt={p.endedAt}
            />
          );
        if (p.kind === "tool")
          return (
            <ToolPart
              key={p.id ?? i}
              {...p}
              onApprove={onApproveTool}
              onDeny={onDenyTool}
            />
          );
        if (p.kind === "todos")
          return (
            <TodosPart key={i} items={p.items} kanbanCards={kanbanTodoCards} />
          );
        return <Markdown key={i} content={p.text} artifactLinks />;
      })}
    </div>
  );
}
