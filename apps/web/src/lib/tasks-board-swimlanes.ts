/**
 * Optional kanban swimlanes / group-by for Tasks boards (#274).
 */

import type { FilterableCard } from "./tasks-board-filters";

export type SwimlaneGroupBy = "none" | "priority" | "assignee";

export type Swimlane = {
  id: string;
  label: string;
  /** Priority value when group-by is priority; otherwise null. */
  priority: number | null;
  /** Assignee login when group-by is assignee; empty string = unassigned. */
  assignee: string | null;
};

type GithubMeta = {
  assignees?: Array<{ login?: string | null }>;
};

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

const PRIORITY_LABELS: Record<number, string> = {
  0: "P0",
  1: "P1",
  2: "P2",
  3: "P3",
};

export function primaryAssigneeLogin(card: FilterableCard): string {
  const gh = parseGithub(card.context_json);
  const login = (gh.assignees?.[0]?.login ?? "").trim();
  return login;
}

export function swimlaneIdForCard(
  card: FilterableCard,
  groupBy: SwimlaneGroupBy
): string {
  if (groupBy === "priority") {
    return `priority:${card.priority ?? 2}`;
  }
  if (groupBy === "assignee") {
    const login = primaryAssigneeLogin(card);
    return login ? `assignee:${login.toLowerCase()}` : "assignee:";
  }
  return "none";
}

export function buildSwimlanes(
  cards: FilterableCard[],
  groupBy: SwimlaneGroupBy
): Swimlane[] {
  if (groupBy === "none") {
    return [{ id: "none", label: "All cards", priority: null, assignee: null }];
  }

  if (groupBy === "priority") {
    // Always show P0–P3 so empty lanes remain drop targets.
    return [0, 1, 2, 3].map((p) => ({
      id: `priority:${p}`,
      label: PRIORITY_LABELS[p] ?? `P${p}`,
      priority: p,
      assignee: null,
    }));
  }

  // assignee
  const logins = new Set<string>();
  let hasUnassigned = false;
  for (const card of cards) {
    if (card.parent_card_id) continue;
    const login = primaryAssigneeLogin(card);
    if (login) logins.add(login);
    else hasUnassigned = true;
  }
  const lanes: Swimlane[] = [...logins]
    .sort((a, b) => a.localeCompare(b))
    .map((login) => ({
      id: `assignee:${login.toLowerCase()}`,
      label: login,
      priority: null,
      assignee: login,
    }));
  if (hasUnassigned || lanes.length === 0) {
    lanes.push({
      id: "assignee:",
      label: "Unassigned",
      priority: null,
      assignee: "",
    });
  }
  return lanes;
}

export function cardsInSwimlane(
  cards: FilterableCard[],
  lane: Swimlane,
  groupBy: SwimlaneGroupBy
): FilterableCard[] {
  if (groupBy === "none") return cards.filter((c) => !c.parent_card_id);
  return cards.filter(
    (c) => !c.parent_card_id && swimlaneIdForCard(c, groupBy) === lane.id
  );
}

export function swimlaneStorageKey(boardKey: string): string {
  return `godmode.tasks.swimlane.${boardKey}`;
}

export function loadSwimlaneGroupBy(boardKey: string): SwimlaneGroupBy {
  try {
    const raw = sessionStorage.getItem(swimlaneStorageKey(boardKey));
    if (raw === "priority" || raw === "assignee" || raw === "none") return raw;
  } catch {
    /* ignore */
  }
  return "none";
}

export function saveSwimlaneGroupBy(
  boardKey: string,
  groupBy: SwimlaneGroupBy
): void {
  try {
    sessionStorage.setItem(swimlaneStorageKey(boardKey), groupBy);
  } catch {
    /* ignore */
  }
}
