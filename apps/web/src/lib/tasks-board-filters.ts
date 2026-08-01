/**
 * Session-scoped filter / search / sort for Tasks kanban boards (#276).
 */

export type BoardSortKey = "priority" | "due" | "updated" | "manual";

export type BoardFilterState = {
  query: string;
  priorities: number[];
  labels: string[];
  assignees: string[];
  milestones: string[];
  columns: string[];
  sort: BoardSortKey;
};

export const DEFAULT_BOARD_FILTER: BoardFilterState = {
  query: "",
  priorities: [],
  labels: [],
  assignees: [],
  milestones: [],
  columns: [],
  sort: "priority",
};

export type FilterableCard = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  tags_json: string | null;
  due_at: string | null;
  priority: number | null;
  sort_order: number;
  parent_card_id: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  context_json: string | null;
};

type GithubMeta = {
  assignees?: Array<{ login?: string | null }>;
  milestone?: { title?: string | null } | null;
};

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

function parseGithub(raw: string | null): GithubMeta {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const github = (parsed as { github?: unknown }).github;
    if (github && typeof github === "object") return github as GithubMeta;
  } catch {
    /* ignore */
  }
  return {};
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function cardMatchesQuery(card: FilterableCard, q: string): boolean {
  if (!q) return true;
  const hay = `${card.title ?? ""}\n${card.description ?? ""}`.toLowerCase();
  return hay.includes(q);
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function toggleFilterValue<K extends keyof BoardFilterState>(
  state: BoardFilterState,
  key: K,
  value: BoardFilterState[K] extends Array<infer U> ? U : never
): BoardFilterState {
  const current = state[key];
  if (!Array.isArray(current)) return state;
  return {
    ...state,
    [key]: toggleInList(current as unknown[], value),
  };
}

export function boardFilterActive(state: BoardFilterState): boolean {
  return (
    normalizeQuery(state.query).length > 0 ||
    state.priorities.length > 0 ||
    state.labels.length > 0 ||
    state.assignees.length > 0 ||
    state.milestones.length > 0 ||
    state.columns.length > 0 ||
    state.sort !== "priority"
  );
}

export function boardFilterNarrowing(state: BoardFilterState): boolean {
  return (
    normalizeQuery(state.query).length > 0 ||
    state.priorities.length > 0 ||
    state.labels.length > 0 ||
    state.assignees.length > 0 ||
    state.milestones.length > 0 ||
    state.columns.length > 0
  );
}

function dueSortKey(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function updatedSortKey(card: FilterableCard): number {
  const raw = card.updated_at || card.created_at || "";
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

export function compareCards(
  a: FilterableCard,
  b: FilterableCard,
  sort: BoardSortKey
): number {
  switch (sort) {
    case "due":
      return (
        dueSortKey(a.due_at) - dueSortKey(b.due_at) ||
        (a.priority ?? 2) - (b.priority ?? 2) ||
        a.sort_order - b.sort_order
      );
    case "updated":
      return (
        updatedSortKey(b) - updatedSortKey(a) ||
        (a.priority ?? 2) - (b.priority ?? 2) ||
        a.sort_order - b.sort_order
      );
    case "manual":
      return a.sort_order - b.sort_order;
    case "priority":
    default:
      return (
        (a.priority ?? 2) - (b.priority ?? 2) || a.sort_order - b.sort_order
      );
  }
}

export function cardPassesBoardFilter(
  card: FilterableCard,
  state: BoardFilterState
): boolean {
  if (card.parent_card_id) return false;
  if (!cardMatchesQuery(card, normalizeQuery(state.query))) return false;
  if (
    state.priorities.length > 0 &&
    !state.priorities.includes(card.priority ?? 2)
  ) {
    return false;
  }
  if (state.columns.length > 0 && !state.columns.includes(card.column_id)) {
    return false;
  }
  const tags = parseTags(card.tags_json);
  if (
    state.labels.length > 0 &&
    !state.labels.some((l) => tags.includes(l))
  ) {
    return false;
  }
  const gh = parseGithub(card.context_json);
  const assigneeLogins = (gh.assignees ?? [])
    .map((a) => (a.login ?? "").toLowerCase())
    .filter(Boolean);
  if (
    state.assignees.length > 0 &&
    !state.assignees.some((a) => assigneeLogins.includes(a.toLowerCase()))
  ) {
    return false;
  }
  const milestone = (gh.milestone?.title ?? "").trim();
  if (
    state.milestones.length > 0 &&
    !state.milestones.includes(milestone)
  ) {
    return false;
  }
  return true;
}

export function filterAndSortBoardCards(
  cards: FilterableCard[],
  state: BoardFilterState
): FilterableCard[] {
  return cards
    .filter((c) => cardPassesBoardFilter(c, state))
    .sort((a, b) => compareCards(a, b, state.sort));
}

export function cardsForColumn(
  cards: FilterableCard[],
  columnId: string,
  state: BoardFilterState
): FilterableCard[] {
  return filterAndSortBoardCards(cards, state).filter(
    (c) => c.column_id === columnId
  );
}

export function collectFilterOptions(cards: FilterableCard[]): {
  labels: string[];
  assignees: string[];
  milestones: string[];
} {
  const labels = new Set<string>();
  const assignees = new Set<string>();
  const milestones = new Set<string>();
  for (const card of cards) {
    if (card.parent_card_id) continue;
    for (const t of parseTags(card.tags_json)) labels.add(t);
    const gh = parseGithub(card.context_json);
    for (const a of gh.assignees ?? []) {
      if (a.login) assignees.add(a.login);
    }
    const m = (gh.milestone?.title ?? "").trim();
    if (m) milestones.add(m);
  }
  return {
    labels: [...labels].sort((a, b) => a.localeCompare(b)),
    assignees: [...assignees].sort((a, b) => a.localeCompare(b)),
    milestones: [...milestones].sort((a, b) => a.localeCompare(b)),
  };
}

export function boardFilterStorageKey(boardKey: string): string {
  return `godmode.tasks.boardFilter.${boardKey}`;
}

export function loadBoardFilter(boardKey: string): BoardFilterState {
  try {
    const raw = sessionStorage.getItem(boardFilterStorageKey(boardKey));
    if (!raw) return { ...DEFAULT_BOARD_FILTER };
    const parsed = JSON.parse(raw) as Partial<BoardFilterState>;
    return {
      ...DEFAULT_BOARD_FILTER,
      ...parsed,
      query: typeof parsed.query === "string" ? parsed.query : "",
      priorities: Array.isArray(parsed.priorities)
        ? parsed.priorities.map(Number).filter((n) => Number.isFinite(n))
        : [],
      labels: Array.isArray(parsed.labels)
        ? parsed.labels.map(String)
        : [],
      assignees: Array.isArray(parsed.assignees)
        ? parsed.assignees.map(String)
        : [],
      milestones: Array.isArray(parsed.milestones)
        ? parsed.milestones.map(String)
        : [],
      columns: Array.isArray(parsed.columns)
        ? parsed.columns.map(String)
        : [],
      sort:
        parsed.sort === "due" ||
        parsed.sort === "updated" ||
        parsed.sort === "manual" ||
        parsed.sort === "priority"
          ? parsed.sort
          : "priority",
    };
  } catch {
    return { ...DEFAULT_BOARD_FILTER };
  }
}

export function saveBoardFilter(boardKey: string, state: BoardFilterState): void {
  try {
    sessionStorage.setItem(
      boardFilterStorageKey(boardKey),
      JSON.stringify(state)
    );
  } catch {
    /* ignore quota */
  }
}
