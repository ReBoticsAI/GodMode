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
  Calendar,
  CheckCircle2,
  Circle,
  ListTree,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  SlidersHorizontal,
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
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  0: { label: "P0", badge: "bg-red-500/20 text-red-400 border-red-500/40" },
  1: { label: "P1", badge: "bg-orange-500/20 text-orange-400 border-orange-500/40" },
  2: { label: "P2", badge: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  3: { label: "P3", badge: "bg-slate-500/20 text-slate-400 border-slate-500/40" },
};

function priorityMeta(p: number | null | undefined) {
  const key = p ?? 2;
  return PRIORITY_META[key] ?? PRIORITY_META[2];
}

type GithubAssignee = {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
};

type GithubMilestone = {
  title: string;
  dueOn?: string | null;
  url?: string | null;
};

type GithubCardMeta = {
  repo?: string;
  issueNumber?: number;
  url?: string;
  assignees?: GithubAssignee[];
  milestone?: GithubMilestone | null;
};

type CardFaceVisibility = {
  priority: boolean;
  labels: boolean;
  assignees: boolean;
  due: boolean;
  milestone: boolean;
};

const DEFAULT_CARD_FACE: CardFaceVisibility = {
  priority: true,
  labels: true,
  assignees: true,
  due: true,
  milestone: true,
};

function cardFaceStorageKey(boardKey: string) {
  return `godmode.tasks.cardFace.${boardKey}`;
}

function loadCardFaceVisibility(boardKey: string): CardFaceVisibility {
  try {
    const raw = localStorage.getItem(cardFaceStorageKey(boardKey));
    if (!raw) return { ...DEFAULT_CARD_FACE };
    const parsed = JSON.parse(raw) as Partial<CardFaceVisibility>;
    return { ...DEFAULT_CARD_FACE, ...parsed };
  } catch {
    return { ...DEFAULT_CARD_FACE };
  }
}

function saveCardFaceVisibility(boardKey: string, value: CardFaceVisibility) {
  try {
    localStorage.setItem(cardFaceStorageKey(boardKey), JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

function normalizeContextObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return { attachments: parsed };
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore malformed */
  }
  return {};
}

function parseGithubCardMeta(raw: string | null): GithubCardMeta {
  const base = normalizeContextObject(raw);
  const github = base.github;
  if (github && typeof github === "object") return github as GithubCardMeta;
  return {};
}

interface CardAttachment {
  id: string;
  label: string;
}

type CardActivityComment = AiCardComment & { cardTitle?: string };

function parseAttachments(raw: string | null): CardAttachment[] {
  const base = normalizeContextObject(raw);
  const source = Array.isArray(base.attachments)
    ? (base.attachments as unknown[])
    : [];
  return source
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .filter((a) => typeof a.id === "string")
    .map((a) => ({ id: String(a.id), label: String(a.label ?? a.id) }));
}

/** Keep github sync metadata while updating attachments. */
function buildCardContextJson(
  existingRaw: string | null,
  attachments: CardAttachment[]
): Record<string, unknown> {
  const base = normalizeContextObject(existingRaw);
  return { ...base, attachments };
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

function formatDueLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return iso;
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dueInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function assigneeInitials(a: GithubAssignee): string {
  const source = (a.name || a.login || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function SortableCard({
  card,
  columns,
  subtaskProgress,
  face,
  onMove,
  onEdit,
}: {
  card: AiProjectCard;
  columns: AiProjectColumn[];
  subtaskProgress?: { total: number; done: number };
  face: CardFaceVisibility;
  onMove: (id: string, columnId: string) => void;
  onEdit: (card: AiProjectCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, data: { columnId: card.column_id } });
  const tags = useMemo(() => parseTags(card.tags_json), [card.tags_json]);
  const gh = useMemo(
    () => parseGithubCardMeta(card.context_json),
    [card.context_json]
  );
  const pm = priorityMeta(card.priority);
  const repoLabel = gh.repo?.includes("/")
    ? gh.repo.split("/")[1]
    : gh.repo;
  const issueRef =
    repoLabel && gh.issueNumber != null
      ? `${repoLabel} #${gh.issueNumber}`
      : null;
  const dueLabel = formatDueLabel(card.due_at);
  const assignees = gh.assignees ?? [];
  const milestoneTitle = gh.milestone?.title;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative rounded-md border bg-card p-2.5 text-xs shadow-sm",
        isDragging && "opacity-60"
      )}
    >
      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 opacity-50 group-hover:opacity-100"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                <span className="sr-only">Move card</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-40">
            {columns
              .filter((c) => c.id !== card.column_id)
              .map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => onMove(card.id, c.id)}
                >
                  Move to {c.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label="Edit card"
          className="rounded p-1 text-muted-foreground opacity-50 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(card);
          }}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      <div
        title="Click to view card"
        className="cursor-pointer pr-12"
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
        {issueRef ? (
          <div className="mb-1 text-[10px] text-muted-foreground">{issueRef}</div>
        ) : null}
        <div className="font-medium leading-snug text-[12px]">{card.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {face.priority ? (
            <Badge
              variant="outline"
              className={cn("h-4 shrink-0 px-1.5 text-[9px] font-semibold", pm.badge)}
              title={`Priority: ${pm.label}`}
            >
              {pm.label}
            </Badge>
          ) : null}
          {card.status === "blocked" && (
            <Badge
              variant="outline"
              className="h-4 shrink-0 border-amber-500/50 bg-amber-500/15 px-1.5 text-[9px] font-semibold text-amber-600"
            >
              BLOCKED
            </Badge>
          )}
          {face.labels
            ? tags.slice(0, 4).map((t) => (
                <Badge key={t} variant="secondary" className="h-4 px-1.5 text-[9px]">
                  {t}
                </Badge>
              ))
            : null}
          {face.milestone && milestoneTitle ? (
            <Badge
              variant="outline"
              className="h-4 max-w-[110px] truncate px-1.5 text-[9px]"
              title={milestoneTitle}
            >
              {milestoneTitle}
            </Badge>
          ) : null}
          {face.due && dueLabel ? (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground"
              title={card.due_at ?? undefined}
            >
              <Calendar className="h-2.5 w-2.5" />
              {dueLabel}
            </span>
          ) : null}
          {subtaskProgress && subtaskProgress.total > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
              <ListTree className="h-2.5 w-2.5" />
              {subtaskProgress.done}/{subtaskProgress.total}
            </span>
          ) : null}
          {face.assignees && assignees.length > 0 ? (
            <AvatarGroup className="ml-auto">
              {assignees.slice(0, 3).map((a) => (
                <Avatar
                  key={a.login}
                  size="sm"
                  className="size-5"
                  title={a.name || a.login}
                >
                  {a.avatarUrl ? <AvatarImage src={a.avatarUrl} alt={a.login} /> : null}
                  <AvatarFallback className="text-[8px]">
                    {assigneeInitials(a)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {assignees.length > 3 ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[8px] text-muted-foreground ring-2 ring-background">
                  +{assignees.length - 3}
                </span>
              ) : null}
            </AvatarGroup>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CardEditorDialog({
  card,
  open,
  onOpenChange,
  scope,
  labelSuggestions,
  onSaved,
  onDeleted,
  onNavigate,
}: {
  card: AiProjectCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProductivityScope;
  labelSuggestions: string[];
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
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [dueAt, setDueAt] = useState("");
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
  const ghMeta = useMemo(
    () => parseGithubCardMeta(card?.context_json ?? null),
    [card?.context_json]
  );

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
    setTags(parseTags(card.tags_json));
    setTagDraft("");
    setDueAt(dueInputValue(card.due_at));
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
      dueAt: dueAt || null,
      contextJson: buildCardContextJson(card.context_json, attachments),
      tags: tags.join(", "),
      assignedAgentId: assignedAgentId || null,
    };
    if (isUserScope(scope)) {
      await updateUserProjectCard(card.id, patch);
    } else {
      await updateProjectCard(card.id, { ...patch, agentId: scope.agentId });
    }
  }, [card, title, description, prompt, priority, dueAt, attachments, tags, assignedAgentId, scope]);

  const toggleTag = (tag: string) => {
    const next = tag.trim();
    if (!next) return;
    setTags((prev) =>
      prev.includes(next) ? prev.filter((t) => t !== next) : [...prev, next]
    );
  };

  const addTagDraft = () => {
    const parts = tagDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setTags((prev) => {
      const set = new Set(prev);
      for (const p of parts) set.add(p);
      return [...set];
    });
    setTagDraft("");
  };

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b">
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
          <SheetTitle>{card?.parent_card_id ? "Edit subtask" : "Edit card"}</SheetTitle>
          <SheetDescription>
            Fields and GodMode actions for this task. Drag cards on the board to change status.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
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
                <SelectItem value="0">P0</SelectItem>
                <SelectItem value="1">P1</SelectItem>
                <SelectItem value="2">P2</SelectItem>
                <SelectItem value="3">P3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="card-due">Due / target date</Label>
            <Input
              id="card-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          {(ghMeta.assignees?.length || ghMeta.milestone) && (
            <div className="grid gap-2 rounded-md border p-2">
              <Label className="text-muted-foreground">GitHub fields</Label>
              {ghMeta.assignees && ghMeta.assignees.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">Assignees</span>
                  <AvatarGroup>
                    {ghMeta.assignees.map((a) => (
                      <Avatar key={a.login} size="sm" title={a.name || a.login}>
                        {a.avatarUrl ? (
                          <AvatarImage src={a.avatarUrl} alt={a.login} />
                        ) : null}
                        <AvatarFallback>{assigneeInitials(a)}</AvatarFallback>
                      </Avatar>
                    ))}
                  </AvatarGroup>
                  <span className="text-[11px] text-muted-foreground">
                    {ghMeta.assignees.map((a) => a.login).join(", ")}
                  </span>
                </div>
              ) : null}
              {ghMeta.milestone ? (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-[10px] text-muted-foreground">Milestone</span>
                  {ghMeta.milestone.url ? (
                    <a
                      href={ghMeta.milestone.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {ghMeta.milestone.title}
                    </a>
                  ) : (
                    <span className="font-medium">{ghMeta.milestone.title}</span>
                  )}
                  {ghMeta.milestone.dueOn ? (
                    <span className="text-muted-foreground">
                      due {formatDueLabel(ghMeta.milestone.dueOn)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <p className="text-[10px] text-muted-foreground">
                Assignees and milestone update on Sync GitHub (read-only here).
              </p>
            </div>
          )}
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
            <Label htmlFor="card-tags">Labels</Label>
            <div className="flex flex-wrap gap-1">
              {tags.length === 0 && (
                <span className="text-[10px] text-muted-foreground">No labels yet.</span>
              )}
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="gap-1">
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    onClick={() => toggleTag(t)}
                    className="rounded hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            {labelSuggestions.filter((s) => !tags.includes(s)).length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {labelSuggestions
                  .filter((s) => !tags.includes(s))
                  .slice(0, 12)
                  .map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => toggleTag(s)}
                    >
                      <Plus data-icon="inline-start" className="h-3 w-3" />
                      {s}
                    </Button>
                  ))}
              </div>
            ) : null}
            <div className="flex gap-1.5">
              <Input
                id="card-tags"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTagDraft();
                  }
                }}
                placeholder="Add label"
                className="h-7 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={addTagDraft}
              >
                Add
              </Button>
            </div>
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
        <SheetFooter className="flex-row justify-between gap-2 border-t sm:justify-between">
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
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function ProjectsBoard({
  scope,
  projectId,
}: {
  scope: ProductivityScope;
  projectId?: string;
}) {
  const [columns, setColumns] = useState<AiProjectColumn[]>([]);
  const [cards, setCards] = useState<AiProjectCard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AiProjectCard | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const boardKey =
    projectId ||
    (isUserScope(scope) ? scope.userId : scope.agentId) ||
    "default";
  const [face, setFace] = useState<CardFaceVisibility>(() =>
    loadCardFaceVisibility(boardKey)
  );
  const { clearReviewUnread } = useIntelligence();
  const readOnly = scopeReadOnly(scope);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    setFace(loadCardFaceVisibility(boardKey));
  }, [boardKey]);

  const setFaceField = (key: keyof CardFaceVisibility, checked: boolean) => {
    setFace((prev) => {
      const next = { ...prev, [key]: checked };
      saveCardFaceVisibility(boardKey, next);
      return next;
    });
  };

  const labelSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) {
      for (const t of parseTags(c.tags_json)) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [cards]);

  const load = useCallback(() => {
    const req = isUserScope(scope)
      ? fetchUserProjects(scope.userId, projectId)
      : fetchAiProjects(scope.agentId);
    req
      .then((r) => {
        setColumns(r.columns);
        setCards(r.cards);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load tasks");
      });
  }, [scope, projectId]);

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
          projectId,
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
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
        <span className="text-xs font-medium text-muted-foreground">Tasks</span>
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                >
                  <SlidersHorizontal data-icon="inline-start" className="h-3.5 w-3.5" />
                  Card fields
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuLabel>Show on card face</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(
                [
                  ["priority", "Priority"],
                  ["labels", "Labels"],
                  ["assignees", "Assignees"],
                  ["due", "Due date"],
                  ["milestone", "Milestone"],
                ] as Array<[keyof CardFaceVisibility, string]>
              ).map(([key, label]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={face[key]}
                  onCheckedChange={(v) => setFaceField(key, !!v)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
        >
          <div className="flex h-full min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden pb-1">
            {columns.map((col) => (
              <div
                key={col.id}
                className="flex min-h-0 min-w-[260px] flex-1 basis-[260px] flex-col rounded-lg border bg-muted/20 p-2"
              >
                <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2 px-0.5">
                  <div className="text-[11px] font-semibold">{col.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {byColumn(col.id).length}
                  </div>
                </div>
                <SortableContext
                  items={byColumn(col.id).map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div
                    className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
                    data-column-id={col.id}
                  >
                    {byColumn(col.id).map((card) => (
                      <div key={card.id} data-column-id={col.id}>
                        <SortableCard
                          card={card}
                          columns={columns}
                          face={face}
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
      </div>
      <CardEditorDialog
        card={editing}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        scope={scope}
        labelSuggestions={labelSuggestions}
        onSaved={load}
        onDeleted={load}
        onNavigate={navigateToCard}
      />
    </div>
  );
}
