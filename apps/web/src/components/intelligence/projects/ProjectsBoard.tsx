import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ListTree,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  fetchAiProjects,
  fetchUserProjects,
  fetchAiAgents,
  moveProjectCard,
  moveUserProjectCard,
  createProjectCard,
  createUserProjectCard,
  updateProjectCard,
  updateUserProjectCard,
  deleteProjectCard,
  deleteUserProjectCard,
  fetchCardSubtasks,
  fetchUserCardSubtasks,
  fetchCardComments,
  fetchUserCardComments,
  addCardComment,
  addUserCardComment,
  fetchWorkflowRuns,
  resumeWorkflowRun,
  enqueueAiJob,
  type AiAgent,
  type AiProjectCard,
  type AiProjectColumn,
  type AiCardComment,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIntelligence } from "@/lib/intelligence-context";
import type { ProductivityScope } from "@/lib/productivity-scope";
import { isUserScope, scopeReadOnly } from "@/lib/productivity-scope";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PRIORITY_META: Record<number, { label: string; badge: string }> = {
  1: { label: "High", badge: "bg-red-500/15 text-red-400 border-red-500/30" },
  2: { label: "Medium", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  3: { label: "Low", badge: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

function priorityMeta(p: number | null | undefined) {
  return PRIORITY_META[p ?? 2] ?? PRIORITY_META[2];
}

interface CardAttachment {
  id: string;
  label: string;
}

type CardActivityComment = AiCardComment & { cardTitle?: string };

function parseAttachments(raw: string | null): CardAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((a) => a && typeof a.id === "string")
        .map((a) => ({ id: String(a.id), label: String(a.label ?? a.id) }));
    }
  } catch {
    /* ignore malformed context */
  }
  return [];
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((t) => String(t)).filter(Boolean);
  } catch {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function SortableCard({
  card,
  subtaskProgress,
  onMove,
  onEdit,
}: {
  card: AiProjectCard;
  subtaskProgress?: { total: number; done: number };
  onMove: (id: string, columnId: string) => void;
  onEdit: (card: AiProjectCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, data: { columnId: card.column_id } });
  const attachmentCount = useMemo(
    () => parseAttachments(card.context_json).length,
    [card.context_json]
  );
  const tags = useMemo(() => parseTags(card.tags_json), [card.tags_json]);
  const hasPrompt = Boolean(card.prompt && card.prompt.trim());
  const pm = priorityMeta(card.priority);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative rounded-md border bg-card p-2 text-xs shadow-sm",
        isDragging && "opacity-60"
      )}
    >
      <button
        type="button"
        aria-label="Edit card"
        className="absolute right-1 top-1 z-10 rounded p-1 text-muted-foreground opacity-50 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(card);
        }}
      >
        <Pencil className="h-3 w-3" />
      </button>
      <div
        title="Click to view card"
        className="cursor-pointer"
        {...attributes}
        {...listeners}
        onClick={() => onEdit(card)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEdit(card);
          }
        }}
      >
        <div className="flex items-start gap-1 pr-5">
          <Badge
            variant="outline"
            className={cn("h-3.5 shrink-0 px-1 text-[8px] font-semibold", pm.badge)}
            title={`Priority: ${pm.label}`}
          >
            {pm.label}
          </Badge>
          {card.status === "blocked" && (
            <Badge
              variant="outline"
              className="h-3.5 shrink-0 border-amber-500/50 bg-amber-500/15 px-1 text-[8px] font-semibold text-amber-600"
              title="Blocked — needs attention (see card comments for the reason)"
            >
              BLOCKED
            </Badge>
          )}
          <span className="font-medium leading-tight">{card.title}</span>
        </div>
        {card.description && (
          <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{card.description}</p>
        )}
        {(hasPrompt || attachmentCount > 0 || tags.length > 0 ||
          (subtaskProgress && subtaskProgress.total > 0)) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
            {subtaskProgress && subtaskProgress.total > 0 && (
              <span className="inline-flex items-center gap-0.5" title="Subtask progress">
                <ListTree className="h-2.5 w-2.5" />
                {subtaskProgress.done}/{subtaskProgress.total}
              </span>
            )}
            {hasPrompt && (
              <span className="inline-flex items-center gap-0.5" title="Has an LLM prompt">
                <MessageSquareText className="h-2.5 w-2.5" />
                prompt
              </span>
            )}
            {attachmentCount > 0 && (
              <span className="inline-flex items-center gap-0.5" title="Attached context">
                <Paperclip className="h-2.5 w-2.5" />
                {attachmentCount}
              </span>
            )}
            {tags.map((t) => (
              <Badge key={t} variant="secondary" className="h-3.5 px-1 text-[8px]">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-1">
        {(["backlog", "in_progress", "review", "done"] as const).map((col) =>
          col !== card.column_id ? (
            <button
              key={col}
              type="button"
              className="rounded border px-1 py-0.5 text-[9px] hover:bg-muted"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onMove(card.id, col);
              }}
            >
              → {col.replace("_", " ")}
            </button>
          ) : null
        )}
      </div>
    </div>
  );
}

function CardEditorDialog({
  card,
  open,
  onOpenChange,
  scope,
  onSaved,
  onDeleted,
  onNavigate,
}: {
  card: AiProjectCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProductivityScope;
  onSaved: () => void;
  onDeleted: () => void;
  onNavigate: (cardId: string) => void;
}) {
  const {
    pageSnapshot,
    breadcrumb,
    pathname,
    mentionSources,
    setSeedText,
    setPanelTab,
    setActiveAgentId,
  } = useIntelligence();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tags, setTags] = useState("");
  const [priority, setPriority] = useState(2);
  const [attachments, setAttachments] = useState<CardAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [subtasks, setSubtasks] = useState<AiProjectCard[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [comments, setComments] = useState<AiCardComment[]>([]);
  const [activityComments, setActivityComments] = useState<CardActivityComment[]>([]);
  const [composer, setComposer] = useState("");
  const [awaitingRunId, setAwaitingRunId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [assignedAgentId, setAssignedAgentId] = useState<string>("");

  const isReview = card?.column_id === "review";

  useEffect(() => {
    fetchAiAgents()
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  }, []);

  const userId = isUserScope(scope) ? scope.userId : undefined;
  const readOnly = scopeReadOnly(scope);

  const reloadSubtasks = useCallback(async () => {
    if (!card) return;
    try {
      const r = isUserScope(scope)
        ? await fetchUserCardSubtasks(card.id, userId)
        : await fetchCardSubtasks(card.id);
      setSubtasks(r.subtasks);
    } catch {
      setSubtasks([]);
    }
  }, [card, scope, userId]);

  const reloadComments = useCallback(async () => {
    if (!card) return;
    try {
      const fetchComments = (cardId: string) =>
        isUserScope(scope)
          ? fetchUserCardComments(cardId, userId)
          : fetchCardComments(cardId);
      const fetchSubtasks = (cardId: string) =>
        isUserScope(scope)
          ? fetchUserCardSubtasks(cardId, userId)
          : fetchCardSubtasks(cardId);

      const r = await fetchComments(card.id);
      setComments(r.comments);

      if (card.parent_card_id) {
        setActivityComments(r.comments);
        return;
      }

      const subtaskRows = await fetchSubtasks(card.id)
        .then((res) => res.subtasks)
        .catch(() => []);
      const subtaskComments = await Promise.all(
        subtaskRows.map((sub) =>
          fetchComments(sub.id)
            .then((res) =>
              res.comments.map((comment) => ({
                ...comment,
                cardTitle: sub.title,
              }))
            )
            .catch(() => [] as CardActivityComment[])
        )
      );
      setActivityComments(
        [
          ...r.comments.map((comment) => ({ ...comment, cardTitle: card.title })),
          ...subtaskComments.flat(),
        ].sort((a, b) => a.created_at.localeCompare(b.created_at))
      );
    } catch {
      setComments([]);
      setActivityComments([]);
    }
  }, [card, scope, userId]);

  useEffect(() => {
    if (!card) return;
    setTitle(card.title ?? "");
    setDescription(card.description ?? "");
    setPrompt(card.prompt ?? "");
    setTags(parseTags(card.tags_json).join(", "));
    setPriority(card.priority ?? 2);
    setAssignedAgentId(card.assigned_agent_id ?? "intelligence");
    setAttachments(parseAttachments(card.context_json));
    setComposer("");
    setNewSubtask("");
    void reloadSubtasks();
    void reloadComments();
    setAwaitingRunId(null);
    if (card.column_id === "review") {
      fetchWorkflowRuns({ status: "awaiting_input", cardId: card.id })
        .then((r) => setAwaitingRunId(r.runs[0]?.id ?? null))
        .catch(() => setAwaitingRunId(null));
    }
  }, [card, reloadSubtasks, reloadComments]);

  const subtaskProgress = useMemo(() => {
    const total = subtasks.length;
    const done = subtasks.filter(
      (s) => s.column_id === "done" || s.status === "accepted"
    ).length;
    return { total, done };
  }, [subtasks]);
  const displayedComments: CardActivityComment[] = card?.parent_card_id
    ? comments.map((comment) => ({ ...comment }))
    : activityComments;

  const addSubtask = async () => {
    if (!card || !newSubtask.trim()) return;
    try {
      if (isUserScope(scope)) {
        await createUserProjectCard({
          title: newSubtask.trim(),
          columnId: "in_progress",
          parentCardId: card.id,
          priority,
        });
      } else {
        await createProjectCard({
          title: newSubtask.trim(),
          columnId: "in_progress",
          parentCardId: card.id,
          priority,
          agentId: scope.agentId,
        });
      }
      setNewSubtask("");
      void reloadSubtasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add subtask");
    }
  };

  const toggleSubtask = async (sub: AiProjectCard) => {
    const isDone = sub.column_id === "done" || sub.status === "accepted";
    const patch = {
      columnId: isDone ? "in_progress" : "done",
      status: isDone ? "working" : "accepted",
    };
    try {
      if (isUserScope(scope)) {
        await updateUserProjectCard(sub.id, patch);
      } else {
        await updateProjectCard(sub.id, { ...patch, agentId: scope.agentId });
      }
      void reloadSubtasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update subtask");
    }
  };

  const postComment = async () => {
    if (!card || !composer.trim()) return;
    try {
      if (isUserScope(scope)) {
        await addUserCardComment(card.id, composer.trim(), "user", userId);
      } else {
        await addCardComment(card.id, composer.trim(), "user");
      }
      setComposer("");
      void reloadComments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post comment");
    }
  };

  const onApprove = async () => {
    if (!awaitingRunId) return;
    setBusy(true);
    try {
      await resumeWorkflowRun(awaitingRunId, "approve");
      onSaved();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const onRequestChanges = async () => {
    if (!awaitingRunId) return;
    setBusy(true);
    try {
      await resumeWorkflowRun(awaitingRunId, "request_changes", composer.trim() || undefined);
      setComposer("");
      onSaved();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const addAttachment = (att: CardAttachment) => {
    setAttachments((prev) =>
      prev.some((a) => a.id === att.id) ? prev : [...prev, att]
    );
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const attachCurrentPage = () => {
    addAttachment({
      id: pageSnapshot?.kind ?? pathname,
      label: pageSnapshot?.label ?? breadcrumb[breadcrumb.length - 1] ?? "Current page",
    });
  };

  const persist = useCallback(async () => {
    if (!card) return;
    const patch = {
      title: title.trim() || "Untitled",
      description,
      prompt,
      priority,
      contextJson: attachments,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(", "),
      assignedAgentId: assignedAgentId || null,
    };
    if (isUserScope(scope)) {
      await updateUserProjectCard(card.id, patch);
    } else {
      await updateProjectCard(card.id, { ...patch, agentId: scope.agentId });
    }
  }, [card, title, description, prompt, priority, attachments, tags, assignedAgentId, scope]);

  const onSave = async () => {
    if (!card) return;
    setBusy(true);
    try {
      await persist();
      onSaved();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    if (!card) return;
    setBusy(true);
    try {
      await persist();
      const note =
        attachments.length > 0
          ? `\n\nAttached context: ${attachments.map((a) => a.label).join(", ")}`
          : "";
      const text = (prompt.trim() || title.trim()) + note;
      setSeedText(text);
      setActiveAgentId(assignedAgentId || "intelligence");
      setPanelTab("chat");
      if (card.linked_workflow_id) {
        try {
          await enqueueAiJob({
            workflowId: card.linked_workflow_id,
            context: { cardId: card.id, assignedAgentId: assignedAgentId || "intelligence" },
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to enqueue workflow");
          return;
        }
      }
      onSaved();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!card) return;
    setBusy(true);
    try {
      if (isUserScope(scope)) {
        await deleteUserProjectCard(card.id);
      } else {
        await deleteProjectCard(card.id, scope.agentId);
      }
      onDeleted();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const availableSources = mentionSources.filter(
    (s) => !attachments.some((a) => a.id === s.id)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          {card?.parent_card_id && (
            <button
              type="button"
              onClick={() => card.parent_card_id && onNavigate(card.parent_card_id)}
              className="-ml-1 mb-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to parent
            </button>
          )}
          <DialogTitle>{card?.parent_card_id ? "Edit subtask" : "Edit card"}</DialogTitle>
          <DialogDescription>
            Give this task a prompt and attach context, then run it with Intelligence.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-1.5">
            <Label htmlFor="card-title">Title</Label>
            <Input
              id="card-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">High</SelectItem>
                <SelectItem value="2">Medium</SelectItem>
                <SelectItem value="3">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Assigned subagent</Label>
            <Select
              value={assignedAgentId}
              onValueChange={(v) => setAssignedAgentId(v ?? "intelligence")}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Intelligence" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.backend})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="card-description">Description</Label>
            <Textarea
              id="card-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              className="min-h-[56px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="card-prompt">Prompt for the LLM</Label>
            <Textarea
              id="card-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Instruction sent to Intelligence when you run this card"
              className="min-h-[120px]"
            />
            <p className="text-[10px] text-muted-foreground">
              This is the instruction Intelligence receives when you click “Run with Intelligence”.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label>Attached context</Label>
            <div className="flex flex-wrap gap-1">
              {attachments.length === 0 && (
                <span className="text-[10px] text-muted-foreground">No context attached.</span>
              )}
              {attachments.map((a) => (
                <Badge key={a.id} variant="secondary" className="gap-1">
                  {a.label}
                  <button
                    type="button"
                    aria-label={`Remove ${a.label}`}
                    onClick={() => removeAttachment(a.id)}
                    className="rounded hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={attachCurrentPage}>
                <Plus className="mr-1 h-3 w-3" />
                Attach current page
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={availableSources.length === 0}
                    >
                      <Paperclip className="mr-1 h-3 w-3" />
                      Add source
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="max-h-60 overflow-auto">
                  {availableSources.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onClick={() => addAttachment({ id: s.id, label: s.label })}
                    >
                      {s.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="card-tags">Tags</Label>
            <Input
              id="card-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="comma, separated, tags"
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Subtasks</Label>
              {subtaskProgress.total > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {subtaskProgress.done}/{subtaskProgress.total} done
                </span>
              )}
            </div>
            {subtaskProgress.total > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{
                    width: `${(subtaskProgress.done / subtaskProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              {subtasks.length === 0 && (
                <span className="text-[10px] text-muted-foreground">No subtasks yet.</span>
              )}
              {subtasks.map((sub) => {
                const done = sub.column_id === "done" || sub.status === "accepted";
                return (
                  <div
                    key={sub.id}
                    className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-muted"
                  >
                    <button
                      type="button"
                      aria-label={done ? "Mark subtask not done" : "Mark subtask done"}
                      onClick={() => void toggleSubtask(sub)}
                      className="shrink-0"
                    >
                      {done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate(sub.id)}
                      className={cn(
                        "flex-1 truncate text-left hover:underline",
                        done && "text-muted-foreground line-through"
                      )}
                    >
                      {sub.title}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1.5">
              <Input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addSubtask();
                  }
                }}
                placeholder="Add a subtask"
                className="h-7 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => void addSubtask()}
              >
                Add
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "grid gap-1.5 rounded-md border p-2",
              isReview ? "border-amber-500/30 bg-amber-500/5" : "border-border"
            )}
          >
            <Label>{card?.parent_card_id ? "Comments" : "Activity"}</Label>
            <div className="flex max-h-40 flex-col gap-1 overflow-auto">
              {displayedComments.length === 0 && (
                <span className="text-[10px] text-muted-foreground">
                  No activity yet.
                </span>
              )}
              {displayedComments.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "rounded px-1.5 py-1 text-[11px]",
                    c.author === "user"
                      ? "bg-primary/10 text-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <span className="mr-1 text-[9px] font-semibold uppercase opacity-60">
                    {c.author}
                  </span>
                  {c.kind && (
                    <span className="mr-1 rounded bg-background/60 px-1 text-[9px] font-medium uppercase opacity-70">
                      {c.kind}
                    </span>
                  )}
                  {!card?.parent_card_id && c.cardTitle && c.cardTitle !== card?.title && (
                    <span className="mr-1 rounded bg-background/60 px-1 text-[9px] font-medium opacity-70">
                      {c.cardTitle}
                    </span>
                  )}
                  {c.body}
                </div>
              ))}
            </div>
            <Textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder={
                isReview
                  ? "Leave a comment or describe requested changes…"
                  : "Leave a comment…"
              }
              className="min-h-[56px] text-[11px]"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => void postComment()}
                disabled={busy || !composer.trim()}
              >
                Add comment
              </Button>
              {isReview && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => void onRequestChanges()}
                    disabled={busy || !awaitingRunId}
                    title={awaitingRunId ? undefined : "No autonomous run is awaiting review"}
                  >
                    Request changes
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void onApprove()}
                    disabled={busy || !awaitingRunId}
                    title={awaitingRunId ? undefined : "No autonomous run is awaiting review"}
                  >
                    Approve
                  </Button>
                </>
              )}
            </div>
            {isReview && !awaitingRunId && (
              <p className="text-[10px] text-muted-foreground">
                Approve / Request changes resume a parked autonomous run. None is awaiting this card.
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => void onDelete()}
            disabled={busy || readOnly}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void onSave()} disabled={busy || readOnly}>
              Save
            </Button>
            <Button type="button" size="sm" onClick={() => void onRun()} disabled={busy}>
              Run with Intelligence
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsBoard({ scope }: { scope: ProductivityScope }) {
  const [columns, setColumns] = useState<AiProjectColumn[]>([]);
  const [cards, setCards] = useState<AiProjectCard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AiProjectCard | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const { clearReviewUnread } = useIntelligence();
  const readOnly = scopeReadOnly(scope);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(() => {
    const req = isUserScope(scope)
      ? fetchUserProjects(scope.userId)
      : fetchAiProjects(scope.agentId);
    req
      .then((r) => {
        setColumns(r.columns);
        setCards(r.cards);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load tasks");
      });
  }, [scope]);

  useEffect(() => {
    load();
    clearReviewUnread();
  }, [load, clearReviewUnread]);

  // Per-parent subtask progress derived from the full card list.
  const subtaskProgressByParent = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const c of cards) {
      if (!c.parent_card_id) continue;
      const cur = map.get(c.parent_card_id) ?? { total: 0, done: 0 };
      cur.total += 1;
      if (c.column_id === "done" || c.status === "accepted") cur.done += 1;
      map.set(c.parent_card_id, cur);
    }
    return map;
  }, [cards]);

  const onMove = async (id: string, columnId: string) => {
    if (readOnly) return;
    try {
      if (isUserScope(scope)) {
        await moveUserProjectCard(id, columnId);
      } else {
        await moveProjectCard(id, columnId, undefined, scope.agentId);
      }
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move card");
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const cardId = String(e.active.id);
    const overCol = e.over?.data.current?.columnId as string | undefined;
    if (overCol) void onMove(cardId, overCol);
  };

  const addCard = async () => {
    if (readOnly) return;
    try {
      if (isUserScope(scope)) {
        await createUserProjectCard({
          title: "New task",
          columnId: "backlog",
        });
      } else {
        await createProjectCard({
          title: "New task",
          columnId: "backlog",
          agentId: scope.agentId,
        });
      }
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add card");
    }
  };

  const openEditor = (card: AiProjectCard) => {
    setEditing(card);
    setEditorOpen(true);
  };

  // Open any card (incl. subtasks) by id in the same editor, e.g. when
  // drilling into a subtask or navigating back to its parent.
  const navigateToCard = (cardId: string) => {
    const target = cards.find((c) => c.id === cardId);
    if (target) openEditor(target);
  };

  // Board shows top-level cards only (subtasks are managed inside the editor),
  // sorted by priority then manual order.
  const byColumn = (colId: string) =>
    cards
      .filter((c) => c.column_id === colId && !c.parent_card_id)
      .sort(
        (a, b) =>
          (a.priority ?? 2) - (b.priority ?? 2) || a.sort_order - b.sort_order
      );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground">Tasks</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={readOnly}
          onClick={() => void addCard()}
        >
          Add card
        </Button>
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
      >
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-auto md:grid-cols-4">
          {columns.map((col) => (
            <div key={col.id} className="flex min-h-[120px] flex-col rounded-lg border bg-muted/20 p-2">
              <div className="mb-2 text-[11px] font-semibold">{col.name}</div>
              <SortableContext items={byColumn(col.id).map((c) => c.id)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-1.5" data-column-id={col.id}>
                  {byColumn(col.id).map((card) => (
                    <div key={card.id} data-column-id={col.id}>
                      <SortableCard
                        card={card}
                        subtaskProgress={subtaskProgressByParent.get(card.id)}
                        onMove={onMove}
                        onEdit={openEditor}
                      />
                    </div>
                  ))}
                </div>
              </SortableContext>
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeId ? (
            <div className="rounded-md border bg-card p-2 text-xs shadow-lg opacity-90">
              {cards.find((c) => c.id === activeId)?.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <CardEditorDialog
        card={editing}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        scope={scope}
        onSaved={load}
        onDeleted={load}
        onNavigate={navigateToCard}
      />
    </div>
  );
}
