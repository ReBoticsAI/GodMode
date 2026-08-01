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
  Filter,
  ListTree,
  MoreHorizontal,
  Paperclip,
  Archive,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  archiveUserProjectCard,
  fetchAiProjects,
  fetchUserProjects,
  fetchAiAgents,
  fetchGithubReposList,
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
import {
  boardFilterActive,
  boardFilterNarrowing,
  cardsForColumn,
  collectFilterOptions,
  DEFAULT_BOARD_FILTER,
  loadBoardFilter,
  saveBoardFilter,
  toggleFilterValue,
  type BoardFilterState,
  type BoardSortKey,
} from "@/lib/tasks-board-filters";
import {
  buildSwimlanes,
  cardsInSwimlane,
  loadSwimlaneGroupBy,
  saveSwimlaneGroupBy,
  type Swimlane,
  type SwimlaneGroupBy,
} from "@/lib/tasks-board-swimlanes";
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
  projectItemId?: string;
  assignees?: GithubAssignee[];
  milestone?: GithubMilestone | null;
};

type GithubCreateMode = "draft" | "issue" | "none";

function createPrefsKey(boardKey: string) {
  return `godmode.tasks.createPrefs.${boardKey}`;
}

function loadCreatePrefs(boardKey: string): {
  mode: GithubCreateMode;
  repo: string;
} {
  try {
    const raw = sessionStorage.getItem(createPrefsKey(boardKey));
    if (!raw) return { mode: "draft", repo: "" };
    const parsed = JSON.parse(raw) as { mode?: string; repo?: string };
    const mode =
      parsed.mode === "issue" || parsed.mode === "none" || parsed.mode === "draft"
        ? parsed.mode
        : "draft";
    return { mode, repo: typeof parsed.repo === "string" ? parsed.repo : "" };
  } catch {
    return { mode: "draft", repo: "" };
  }
}

function saveCreatePrefs(
  boardKey: string,
  prefs: { mode: GithubCreateMode; repo: string }
) {
  try {
    sessionStorage.setItem(createPrefsKey(boardKey), JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

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

/** Keep github sync metadata while updating attachments (and optional GH field edits). */
function buildCardContextJson(
  existingRaw: string | null,
  attachments: CardAttachment[],
  githubPatch?: Record<string, unknown>
): Record<string, unknown> {
  const base = normalizeContextObject(existingRaw);
  const next: Record<string, unknown> = { ...base, attachments };
  if (githubPatch) {
    const prevGh =
      base.github && typeof base.github === "object"
        ? (base.github as Record<string, unknown>)
        : {};
    next.github = { ...prevGh, ...githubPatch };
  }
  return next;
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

function firstVisibleColumnId(columns: AiProjectColumn[]): string {
  return columns[0]?.id ?? "backlog";
}

function pickSubtaskColumnId(
  columns: AiProjectColumn[],
  parentColumnId: string
): string {
  if (columns.some((c) => c.id === parentColumnId)) return parentColumnId;
  const inProgress = columns.find((c) => c.id === "in_progress");
  if (inProgress) return inProgress.id;
  return firstVisibleColumnId(columns);
}

function doneColumnId(columns: AiProjectColumn[]): string {
  if (columns.some((c) => c.id === "done")) return "done";
  return columns[columns.length - 1]?.id ?? "done";
}

function workingColumnId(
  columns: AiProjectColumn[],
  parentColumnId: string
): string {
  if (columns.some((c) => c.id === "in_progress")) return "in_progress";
  if (columns.some((c) => c.id === parentColumnId)) return parentColumnId;
  return firstVisibleColumnId(columns);
}

function SortableCard({
  card,
  columns,
  subtaskProgress,
  face,
  lanePriority,
  onMove,
  onEdit,
}: {
  card: AiProjectCard;
  columns: AiProjectColumn[];
  subtaskProgress?: { total: number; done: number };
  face: CardFaceVisibility;
  lanePriority?: number | null;
  onMove: (id: string, columnId: string) => void;
  onEdit: (card: AiProjectCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.id,
      data: {
        columnId: card.column_id,
        lanePriority: lanePriority ?? undefined,
      },
    });
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
  columns,
  labelSuggestions,
  githubSyncEnabled,
  onSaved,
  onDeleted,
  onNavigate,
}: {
  card: AiProjectCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ProductivityScope;
  columns: AiProjectColumn[];
  labelSuggestions: string[];
  githubSyncEnabled?: boolean;
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
  const [assigneeLogins, setAssigneeLogins] = useState("");
  const [milestoneTitleEdit, setMilestoneTitleEdit] = useState("");

  const isReview = card?.column_id === "review";
  const ghMeta = useMemo(
    () => parseGithubCardMeta(card?.context_json ?? null),
    [card?.context_json]
  );
  const showGithubFields = isUserScope(scope);

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
    const meta = parseGithubCardMeta(card.context_json);
    setAssigneeLogins((meta.assignees ?? []).map((a) => a.login).join(", "));
    setMilestoneTitleEdit(meta.milestone?.title ?? "");
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
    const doneId = doneColumnId(columns);
    const total = subtasks.length;
    const done = subtasks.filter(
      (s) => s.column_id === doneId || s.status === "accepted"
    ).length;
    return { total, done };
  }, [subtasks, columns]);
  const displayedComments: CardActivityComment[] = card?.parent_card_id
    ? comments.map((comment) => ({ ...comment }))
    : activityComments;

  const addSubtask = async () => {
    if (!card || !newSubtask.trim()) return;
    const columnId = pickSubtaskColumnId(columns, card.column_id);
    try {
      if (isUserScope(scope)) {
        await createUserProjectCard({
          title: newSubtask.trim(),
          columnId,
          parentCardId: card.id,
          priority,
          projectId: card.project_id,
        });
      } else {
        await createProjectCard({
          title: newSubtask.trim(),
          columnId,
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
    const doneId = doneColumnId(columns);
    const workId = workingColumnId(columns, card?.column_id ?? doneId);
    const isDone = sub.column_id === doneId || sub.status === "accepted";
    const patch = {
      columnId: isDone ? workId : doneId,
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
    const githubPatch: Record<string, unknown> | undefined = showGithubFields
      ? {
          assignees: assigneeLogins
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((login) => ({ login })),
          milestone: milestoneTitleEdit.trim()
            ? { title: milestoneTitleEdit.trim() }
            : null,
        }
      : undefined;
    const patch = {
      title: title.trim() || "Untitled",
      description,
      prompt,
      priority,
      dueAt: dueAt || null,
      contextJson: buildCardContextJson(
        card.context_json,
        attachments,
        githubPatch
      ),
      tags: tags.join(", "),
      assignedAgentId: assignedAgentId || null,
    };
    if (isUserScope(scope)) {
      await updateUserProjectCard(card.id, patch);
    } else {
      await updateProjectCard(card.id, { ...patch, agentId: scope.agentId });
    }
  }, [
    card,
    title,
    description,
    prompt,
    priority,
    dueAt,
    attachments,
    tags,
    assignedAgentId,
    scope,
    showGithubFields,
    assigneeLogins,
    milestoneTitleEdit,
  ]);

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

  const linkedGh = useMemo(
    () => (card ? parseGithubCardMeta(card.context_json) : {}),
    [card]
  );
  const hasProjectItem = Boolean(linkedGh.projectItemId);
  const showGithubLifecycle = Boolean(githubSyncEnabled && isUserScope(scope));

  const onDelete = async () => {
    if (!card) return;
    const linked = showGithubLifecycle && hasProjectItem;
    const ok = window.confirm(
      linked
        ? "Remove this card from the board and from the GitHub Project? The underlying Issue or PR is kept."
        : "Delete this card from the board? This cannot be undone."
    );
    if (!ok) return;
    setBusy(true);
    try {
      if (isUserScope(scope)) {
        await deleteUserProjectCard(card.id);
      } else {
        await deleteProjectCard(card.id, scope.agentId);
      }
      toast.success(
        linked
          ? "Removed from Project (Issue/PR kept)"
          : "Card deleted"
      );
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const onArchive = async () => {
    if (!card || !isUserScope(scope)) return;
    const ok = window.confirm(
      hasProjectItem
        ? "Archive this item on the GitHub Project and remove it from this board? The underlying Issue or PR is kept."
        : "Remove this local card from the board? It was never linked to a Project item."
    );
    if (!ok) return;
    setBusy(true);
    try {
      if (hasProjectItem) {
        await archiveUserProjectCard(card.id);
        toast.success("Archived on GitHub Project (Issue/PR kept)");
      } else {
        await deleteUserProjectCard(card.id);
        toast.success("Card removed");
      }
      onDeleted();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed");
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
          {showGithubFields ? (
            <div className="grid gap-2 rounded-md border p-2">
              <Label className="text-muted-foreground">GitHub</Label>
              <div className="grid gap-1.5">
                <Label htmlFor="gh-assignees" className="text-xs">
                  Assignees
                </Label>
                <Input
                  id="gh-assignees"
                  value={assigneeLogins}
                  onChange={(e) => setAssigneeLogins(e.target.value)}
                  placeholder="login1, login2"
                  className="h-8 text-xs"
                  disabled={readOnly}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gh-milestone" className="text-xs">
                  Milestone
                </Label>
                <Input
                  id="gh-milestone"
                  value={milestoneTitleEdit}
                  onChange={(e) => setMilestoneTitleEdit(e.target.value)}
                  placeholder="Milestone title"
                  className="h-8 text-xs"
                  disabled={readOnly}
                />
              </div>
              {ghMeta.repo && ghMeta.issueNumber != null ? (
                <p className="text-[10px] text-muted-foreground">
                  Linked to {ghMeta.repo} #{ghMeta.issueNumber}. Changes push to
                  GitHub when you save.
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  Assignees and milestone apply to linked Issues and PRs. Draft
                  issues ignore them until promoted.
                </p>
              )}
            </div>
          ) : null}
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
                const doneId = doneColumnId(columns);
                const done = sub.column_id === doneId || sub.status === "accepted";
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
        <SheetFooter className="flex-col items-stretch gap-2 border-t sm:flex-col">
          {showGithubLifecycle ? (
            <p className="text-[10px] leading-snug text-muted-foreground">
              Archive keeps the Issue/PR and archives the Project item. Remove from
              Project deletes the Project item only (Issue/PR stays). Sync drops
              local cards when items are archived or removed on GitHub.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {showGithubLifecycle ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onArchive()}
                  disabled={busy || readOnly}
                >
                  <Archive className="mr-1 h-3.5 w-3.5" />
                  Archive
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => void onDelete()}
                disabled={busy || readOnly}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {showGithubLifecycle && hasProjectItem
                  ? "Remove from Project"
                  : "Delete"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void onSave()} disabled={busy || readOnly}>
                Save
              </Button>
              <Button type="button" size="sm" onClick={() => void onRun()} disabled={busy}>
                Run with Intelligence
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function ProjectsBoard({
  scope,
  projectId,
  githubSyncEnabled = false,
  defaultGithubRepo = "",
}: {
  scope: ProductivityScope;
  projectId?: string;
  /** Linked user board: adapter defaults new cards to GitHub draft on create. */
  githubSyncEnabled?: boolean;
  defaultGithubRepo?: string;
}) {
  const [columns, setColumns] = useState<AiProjectColumn[]>([]);
  const [cards, setCards] = useState<AiProjectCard[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AiProjectCard | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("New task");
  const [createMode, setCreateMode] = useState<GithubCreateMode>("draft");
  const [createRepo, setCreateRepo] = useState("");
  const [repoOptions, setRepoOptions] = useState<string[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const boardKey =
    projectId ||
    (isUserScope(scope) ? scope.userId : scope.agentId) ||
    "default";
  const [face, setFace] = useState<CardFaceVisibility>(() =>
    loadCardFaceVisibility(boardKey)
  );
  const [filter, setFilter] = useState<BoardFilterState>(() =>
    loadBoardFilter(boardKey)
  );
  const [groupBy, setGroupBy] = useState<SwimlaneGroupBy>(() =>
    loadSwimlaneGroupBy(boardKey)
  );
  const { clearReviewUnread } = useIntelligence();
  const readOnly = scopeReadOnly(scope);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    setFace(loadCardFaceVisibility(boardKey));
    setFilter(loadBoardFilter(boardKey));
    setGroupBy(loadSwimlaneGroupBy(boardKey));
    const prefs = loadCreatePrefs(boardKey);
    setCreateMode(prefs.mode);
    setCreateRepo(prefs.repo || defaultGithubRepo);
  }, [boardKey, defaultGithubRepo]);

  useEffect(() => {
    if (!createOpen || !githubSyncEnabled || createMode !== "issue") return;
    if (repoOptions.length > 0) return;
    setReposLoading(true);
    fetchGithubReposList()
      .then((r) => {
        const names = r.repos.map((x) => x.fullName);
        setRepoOptions(names);
        if (!createRepo && names[0]) setCreateRepo(names[0]);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Could not list repos");
      })
      .finally(() => setReposLoading(false));
  }, [createOpen, githubSyncEnabled, createMode, repoOptions.length, createRepo]);

  const setFaceField = (key: keyof CardFaceVisibility, checked: boolean) => {
    setFace((prev) => {
      const next = { ...prev, [key]: checked };
      saveCardFaceVisibility(boardKey, next);
      return next;
    });
  };

  const updateFilter = (next: BoardFilterState) => {
    setFilter(next);
    saveBoardFilter(boardKey, next);
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
    const doneId = doneColumnId(columns);
    const map = new Map<string, { total: number; done: number }>();
    for (const c of cards) {
      if (!c.parent_card_id) continue;
      const cur = map.get(c.parent_card_id) ?? { total: 0, done: 0 };
      cur.total += 1;
      if (c.column_id === doneId || c.status === "accepted") cur.done += 1;
      map.set(c.parent_card_id, cur);
    }
    return map;
  }, [cards, columns]);

  const onMove = async (
    id: string,
    columnId: string,
    lanePriority?: number | null
  ) => {
    if (readOnly) return;
    try {
      if (isUserScope(scope)) {
        await moveUserProjectCard(id, columnId);
        if (
          groupBy === "priority" &&
          lanePriority != null &&
          Number.isFinite(lanePriority)
        ) {
          const current = cards.find((c) => c.id === id);
          if (current && (current.priority ?? 2) !== lanePriority) {
            await updateUserProjectCard(id, { priority: lanePriority });
          }
        }
      } else {
        await moveProjectCard(id, columnId, undefined, scope.agentId);
        if (
          groupBy === "priority" &&
          lanePriority != null &&
          Number.isFinite(lanePriority)
        ) {
          const current = cards.find((c) => c.id === id);
          if (current && (current.priority ?? 2) !== lanePriority) {
            await updateProjectCard(id, {
              priority: lanePriority,
              agentId: scope.agentId,
            });
          }
        }
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
    const overPriority = e.over?.data.current?.lanePriority as
      | number
      | undefined;
    if (overCol) void onMove(cardId, overCol, overPriority);
  };

  const openCreate = () => {
    if (readOnly) return;
    if (githubSyncEnabled && isUserScope(scope)) {
      const prefs = loadCreatePrefs(boardKey);
      setCreateTitle("New task");
      setCreateMode(prefs.mode);
      setCreateRepo(prefs.repo || defaultGithubRepo);
      setCreateOpen(true);
      return;
    }
    void addCardQuick();
  };

  const addCardQuick = async () => {
    if (readOnly) return;
    const firstCol = firstVisibleColumnId(columns);
    try {
      if (isUserScope(scope)) {
        await createUserProjectCard({
          title: "New task",
          columnId: firstCol,
          projectId,
        });
      } else {
        await createProjectCard({
          title: "New task",
          columnId: firstCol,
          agentId: scope.agentId,
        });
      }
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add card");
    }
  };

  const submitCreate = async () => {
    if (readOnly) return;
    const title = createTitle.trim() || "New task";
    if (createMode === "issue" && !createRepo.includes("/")) {
      toast.error("Pick a repository (owner/name) to create an Issue");
      return;
    }
    const firstCol = firstVisibleColumnId(columns);
    setCreateOpen(false);
    saveCreatePrefs(boardKey, { mode: createMode, repo: createRepo });
    try {
      await createUserProjectCard({
        title,
        columnId: firstCol,
        projectId,
        githubCreateMode: createMode,
        githubRepo: createMode === "issue" ? createRepo : undefined,
      });
      toast.success(
        createMode === "issue"
          ? "Card created as Issue on the Project"
          : createMode === "draft"
            ? "Card created as Draft on the Project"
            : "Local card created"
      );
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

  const filterOptions = useMemo(() => collectFilterOptions(cards), [cards]);
  const filterNarrowing = boardFilterNarrowing(filter);
  const filterIsActive = boardFilterActive(filter);
  const matchedCount = useMemo(() => {
    const ids = new Set<string>();
    for (const col of columns) {
      for (const c of cardsForColumn(cards, col.id, filter)) ids.add(c.id);
    }
    return ids.size;
  }, [cards, columns, filter]);

  const lanes = useMemo(
    () => buildSwimlanes(cards, groupBy),
    [cards, groupBy]
  );

  // Board shows top-level cards only (subtasks are managed inside the editor).
  const byColumn = (colId: string, lane?: Swimlane) => {
    const pool =
      groupBy === "none" || !lane
        ? cards
        : (cardsInSwimlane(cards, lane, groupBy) as AiProjectCard[]);
    return cardsForColumn(pool, colId, filter) as AiProjectCard[];
  };

  const visibleColumns = columns.filter(
    (col) => filter.columns.length === 0 || filter.columns.includes(col.id)
  );

  const renderColumn = (col: AiProjectColumn, lane: Swimlane) => {
    const visible = byColumn(col.id, lane);
    const count = visible.length;
    const totalInCol = (
      groupBy === "none"
        ? cards
        : cardsInSwimlane(cards, lane, groupBy)
    ).filter((c) => c.column_id === col.id && !c.parent_card_id).length;
    const wip =
      col.wip_limit != null && col.wip_limit > 0 ? col.wip_limit : null;
    const overWip = wip != null && totalInCol > wip;
    return (
      <div
        key={`${lane.id}:${col.id}`}
        className="flex min-h-0 min-w-[260px] grow basis-[260px] shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/20 p-2"
      >
        <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2 px-0.5">
          <div className="text-[11px] font-semibold">{col.name}</div>
          <div
            className={cn(
              "text-[10px]",
              overWip
                ? "font-medium text-destructive"
                : "text-muted-foreground"
            )}
          >
            {wip != null
              ? `${totalInCol}/${wip}`
              : filterNarrowing && count !== totalInCol
                ? `${count}/${totalInCol}`
                : count}
          </div>
        </div>
        <SortableContext
          items={visible.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div
            className="flex min-h-[120px] flex-1 flex-col gap-1.5 overflow-y-auto"
            data-column-id={col.id}
          >
            {visible.map((card) => (
              <div key={card.id} data-column-id={col.id}>
                <SortableCard
                  card={card}
                  columns={columns}
                  face={face}
                  lanePriority={lane.priority}
                  subtaskProgress={subtaskProgressByParent.get(card.id)}
                  onMove={(id, columnId) =>
                    void onMove(id, columnId, lane.priority)
                  }
                  onEdit={openEditor}
                />
              </div>
            ))}
          </div>
        </SortableContext>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-2 px-1">
        <div className="flex items-center justify-between gap-2">
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
              onClick={() => openCreate()}
            >
              Add card
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[160px] flex-1 basis-[180px]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter.query}
              onChange={(e) =>
                updateFilter({ ...filter, query: e.target.value })
              }
              placeholder="Search title or body"
              className="h-7 pl-7 text-xs"
              aria-label="Search cards"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-7 text-xs",
                    filter.priorities.length > 0 && "border-primary/50"
                  )}
                >
                  <Filter data-icon="inline-start" className="h-3.5 w-3.5" />
                  Priority
                  {filter.priorities.length > 0
                    ? ` (${filter.priorities.length})`
                    : ""}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-36">
              <DropdownMenuLabel>Priority</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {[0, 1, 2, 3].map((p) => (
                <DropdownMenuCheckboxItem
                  key={p}
                  checked={filter.priorities.includes(p)}
                  onCheckedChange={() =>
                    updateFilter(toggleFilterValue(filter, "priorities", p))
                  }
                >
                  P{p}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-7 text-xs",
                    filter.labels.length > 0 && "border-primary/50"
                  )}
                  disabled={filterOptions.labels.length === 0}
                >
                  Labels
                  {filter.labels.length > 0 ? ` (${filter.labels.length})` : ""}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuLabel>Labels</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {filterOptions.labels.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label}
                  checked={filter.labels.includes(label)}
                  onCheckedChange={() =>
                    updateFilter(toggleFilterValue(filter, "labels", label))
                  }
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-7 text-xs",
                    filter.assignees.length > 0 && "border-primary/50"
                  )}
                  disabled={filterOptions.assignees.length === 0}
                >
                  Assignees
                  {filter.assignees.length > 0
                    ? ` (${filter.assignees.length})`
                    : ""}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuLabel>Assignees</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {filterOptions.assignees.map((login) => (
                <DropdownMenuCheckboxItem
                  key={login}
                  checked={filter.assignees.includes(login)}
                  onCheckedChange={() =>
                    updateFilter(toggleFilterValue(filter, "assignees", login))
                  }
                >
                  {login}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-7 text-xs",
                    filter.milestones.length > 0 && "border-primary/50"
                  )}
                  disabled={filterOptions.milestones.length === 0}
                >
                  Milestone
                  {filter.milestones.length > 0
                    ? ` (${filter.milestones.length})`
                    : ""}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuLabel>Milestone</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {filterOptions.milestones.map((m) => (
                <DropdownMenuCheckboxItem
                  key={m}
                  checked={filter.milestones.includes(m)}
                  onCheckedChange={() =>
                    updateFilter(toggleFilterValue(filter, "milestones", m))
                  }
                >
                  {m}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-7 text-xs",
                    filter.columns.length > 0 && "border-primary/50"
                  )}
                  disabled={columns.length === 0}
                >
                  Status
                  {filter.columns.length > 0
                    ? ` (${filter.columns.length})`
                    : ""}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuLabel>Column / Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={filter.columns.includes(col.id)}
                  onCheckedChange={() =>
                    updateFilter(toggleFilterValue(filter, "columns", col.id))
                  }
                >
                  {col.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Select
            value={filter.sort}
            onValueChange={(v) =>
              updateFilter({ ...filter, sort: v as BoardSortKey })
            }
          >
            <SelectTrigger className="h-7 w-[140px] text-xs" size="sm">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">Sort: Priority</SelectItem>
              <SelectItem value="due">Sort: Due date</SelectItem>
              <SelectItem value="updated">Sort: Updated</SelectItem>
              <SelectItem value="manual">Sort: Manual</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={groupBy}
            onValueChange={(v) => {
              const next = (v as SwimlaneGroupBy) ?? "none";
              setGroupBy(next);
              saveSwimlaneGroupBy(boardKey, next);
            }}
          >
            <SelectTrigger className="h-7 w-[150px] text-xs" size="sm">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Group: None</SelectItem>
              <SelectItem value="priority">Group: Priority</SelectItem>
              <SelectItem value="assignee">Group: Assignee</SelectItem>
            </SelectContent>
          </Select>
          {filterIsActive ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => updateFilter({ ...DEFAULT_BOARD_FILTER })}
            >
              <X data-icon="inline-start" className="h-3.5 w-3.5" />
              Clear
            </Button>
          ) : null}
          {filterNarrowing ? (
            <span className="text-[10px] text-muted-foreground">
              {matchedCount} match{matchedCount === 1 ? "" : "es"}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {filterNarrowing && matchedCount === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed bg-muted/10 p-6 text-center">
            <div>
              <p className="text-sm font-medium">No cards match</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Clear filters or adjust search to see cards again.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3 h-7 text-xs"
                onClick={() => updateFilter({ ...DEFAULT_BOARD_FILTER })}
              >
                Clear filters
              </Button>
            </div>
          </div>
        ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
        >
          {groupBy === "none" ? (
            <div className="flex h-full min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden pb-1">
              {visibleColumns.map((col) =>
                renderColumn(col, lanes[0] ?? {
                  id: "none",
                  label: "All cards",
                  priority: null,
                  assignee: null,
                })
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-1">
              {lanes.map((lane) => (
                <div
                  key={lane.id}
                  className="flex shrink-0 flex-col gap-1.5 rounded-lg border border-border/60 bg-background/40 p-2"
                >
                  <div className="px-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
                    {lane.label}
                  </div>
                  <div className="flex min-h-[160px] gap-2 overflow-x-auto">
                    {visibleColumns.map((col) => renderColumn(col, lane))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <DragOverlay>
            {activeId ? (
              <div className="rounded-md border bg-card p-2 text-xs shadow-lg opacity-90">
                {cards.find((c) => c.id === activeId)?.title}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        )}
      </div>
      <CardEditorDialog
        card={editing}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        scope={scope}
        columns={columns}
        labelSuggestions={labelSuggestions}
        githubSyncEnabled={githubSyncEnabled}
        onSaved={load}
        onDeleted={load}
        onNavigate={navigateToCard}
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add card</DialogTitle>
            <DialogDescription>
              On a linked board, create a Draft Project item, a real Issue in a
              repo, or a local-only card.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-title">Title</Label>
              <Input
                id="create-title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Create as</Label>
              <Select
                value={createMode}
                onValueChange={(v) =>
                  setCreateMode((v as GithubCreateMode) ?? "draft")
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft on Project (default)</SelectItem>
                  <SelectItem value="issue">Issue in a repository</SelectItem>
                  <SelectItem value="none">Local only (no GitHub)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createMode === "issue" ? (
              <div className="flex flex-col gap-1.5">
                <Label>Repository</Label>
                <Select
                  value={createRepo || undefined}
                  onValueChange={(v) => setCreateRepo(v ?? "")}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue
                      placeholder={
                        reposLoading ? "Loading repos…" : "Select repo"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {repoOptions.map((repo) => (
                      <SelectItem key={repo} value={repo}>
                        {repo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Repos the connected GitHub App / token can access.
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void submitCreate()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
