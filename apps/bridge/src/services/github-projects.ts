/**
 * GitHub Projects (v2) list + board sync into GodMode TaskCards.
 */
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import {
  getUserBoard,
  slugBoardColumnId,
  type BoardColumnDef,
  type UserBoardRow,
  userProjectId,
} from "./user-productivity.js";
import { readGithubProjectsToken, resolveGithubProjectsAccessToken } from "./github-integration.js";
import {
  emptyExtraFields,
  isDueDateFieldName,
  isEstimateFieldName,
  isIterationFieldName,
  isStartDateFieldName,
  isTextNoteFieldName,
  type ExtraProjectFields,
} from "./github-projects-fields.js";

export type GithubProjectSummary = {
  id: string;
  title: string;
  url: string;
  number: number;
  owner: string;
};

export type GithubRepoSummary = {
  fullName: string;
  private: boolean;
};

type StatusOption = { id: string; name: string };

type ProjectMeta = {
  id: string;
  title: string;
  url: string;
  statusFieldId: string | null;
  statusOptions: StatusOption[];
  dateFieldId: string | null;
  startDateFieldId: string | null;
  priorityFieldId: string | null;
  priorityOptions: StatusOption[];
  estimateFieldId: string | null;
  textFieldId: string | null;
  iterationFieldId: string | null;
  iterationOptions: Array<{ id: string; title: string }>;
};

type GithubAssignee = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

type GithubMilestone = {
  title: string;
  dueOn: string | null;
  url: string | null;
};

type ProjectItem = {
  itemId: string;
  title: string;
  body: string;
  statusName: string | null;
  statusOptionId: string | null;
  dueAt: string | null;
  priorityName: string | null;
  labels: string[];
  assignees: GithubAssignee[];
  milestone: GithubMilestone | null;
  url: string | null;
  issueNumber: number | null;
  repo: string | null;
  contentId: string | null;
} & ExtraProjectFields;

const DEFAULT_STATUS_ALIASES: Record<string, string[]> = {
  backlog: ["todo", "backlog", "new", "triage"],
  ready: ["ready"],
  in_progress: ["in progress", "in_progress", "doing", "active", "wip"],
  review: ["in review", "review", "needs review", "waiting"],
  done: ["done", "complete", "completed", "closed", "finished"],
};

async function requireToken(db: AppDatabase): Promise<string> {
  return resolveGithubProjectsAccessToken(db);
}

async function githubGraphql<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "GodMode",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (!res.ok || json.errors?.length) {
    const msg =
      json.errors?.map((e) => e.message).join("; ") ||
      `GitHub GraphQL failed (${res.status})`;
    const status = res.status === 401 || res.status === 403 ? 403 : 502;
    throw Object.assign(new Error(msg), { status });
  }
  return json.data as T;
}

type ProjectNode = {
  id: string;
  title: string;
  number: number;
  url: string;
};

/**
 * List repositories the connected GitHub token can access (for Issue create).
 */
export async function listGithubReposForUser(
  _userId: string,
  db: AppDatabase
): Promise<GithubRepoSummary[]> {
  const accessToken = await requireToken(db);
  const out: GithubRepoSummary[] = [];
  let page = 1;
  while (page <= 5) {
    const url = new URL("https://api.github.com/user/repos");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "GodMode",
      },
    });
    if (!res.ok) {
      const status = res.status === 401 || res.status === 403 ? 403 : 502;
      throw Object.assign(
        new Error(`GitHub repos list failed (${res.status})`),
        { status }
      );
    }
    const batch = (await res.json()) as Array<{
      full_name?: string;
      private?: boolean;
    }>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      if (typeof r.full_name === "string" && r.full_name.includes("/")) {
        out.push({ fullName: r.full_name, private: Boolean(r.private) });
      }
    }
    if (batch.length < 100) break;
    page += 1;
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return out;
}

/**
 * List Projects the connected GitHub account can see.
 * User-owned projects and org projects are queried separately so a missing
 * `read:org` scope cannot fail the whole list (INSUFFICIENT_SCOPES on orgs).
 */
export async function listGithubProjectsForUser(
  _userId: string,
  db: AppDatabase
): Promise<GithubProjectSummary[]> {
  const accessToken = await requireToken(db);
  const out: GithubProjectSummary[] = [];
  const seen = new Set<string>();

  const userData = await githubGraphql<{
    viewer: {
      login: string;
      projectsV2: { nodes: Array<ProjectNode | null> };
    };
  }>(
    accessToken,
    `query {
      viewer {
        login
        projectsV2(first: 40) {
          nodes { id title number url }
        }
      }
    }`
  );
  const ownerLogin = userData.viewer.login;
  for (const p of userData.viewer.projectsV2.nodes ?? []) {
    if (!p?.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({
      id: p.id,
      title: p.title,
      url: p.url,
      number: p.number,
      owner: ownerLogin,
    });
  }

  try {
    const orgData = await githubGraphql<{
      viewer: {
        organizations: {
          nodes: Array<{
            login: string;
            projectsV2: { nodes: Array<ProjectNode | null> };
          } | null>;
        };
      };
    }>(
      accessToken,
      `query {
        viewer {
          organizations(first: 20) {
            nodes {
              login
              projectsV2(first: 40) {
                nodes { id title number url }
              }
            }
          }
        }
      }`
    );
    for (const org of orgData.viewer.organizations.nodes ?? []) {
      if (!org?.login) continue;
      for (const p of org.projectsV2.nodes ?? []) {
        if (!p?.id || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push({
          id: p.id,
          title: p.title,
          url: p.url,
          number: p.number,
          owner: org.login,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Without read:org, GitHub rejects the organizations field entirely.
    if (!/read:org|INSUFFICIENT_SCOPES/i.test(msg)) throw err;
  }

  return out;
}

async function loadProjectMeta(
  accessToken: string,
  projectNodeId: string
): Promise<ProjectMeta> {
  const data = await githubGraphql<{
    node: {
      id: string;
      title: string;
      url: string;
      fields: {
        nodes: Array<{
          id?: string;
          name?: string;
          options?: StatusOption[];
          dataType?: string;
          configuration?: {
            iterations?: Array<{ id: string; title: string }>;
          };
        }>;
      };
    } | null;
  }>(
    accessToken,
    `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          id title url
          fields(first: 40) {
            nodes {
              ... on ProjectV2FieldCommon { id name dataType }
              ... on ProjectV2SingleSelectField {
                id name dataType
                options { id name }
              }
              ... on ProjectV2IterationField {
                id name dataType
                configuration {
                  iterations { id title }
                }
              }
            }
          }
        }
      }
    }`,
    { id: projectNodeId }
  );
  if (!data.node?.id) {
    throw Object.assign(
      new Error(
        "GitHub Project not found or you are not authorized to access it"
      ),
      { status: 403 }
    );
  }
  const fields = data.node.fields.nodes ?? [];
  const status =
    fields.find((f) => f.name?.toLowerCase() === "status" && f.options) ??
    fields.find((f) => f.options && f.options.length > 0);
  const dateField =
    fields.find((f) => isDueDateFieldName(f.name ?? "")) ?? null;
  const startDateField =
    fields.find((f) => isStartDateFieldName(f.name ?? "")) ?? null;
  const priorityField =
    fields.find((f) => (f.name ?? "").toLowerCase() === "priority" && f.options) ??
    null;
  const estimateField =
    fields.find((f) => isEstimateFieldName(f.name ?? "")) ?? null;
  const textField =
    fields.find((f) => isTextNoteFieldName(f.name ?? "")) ?? null;
  const iterationField =
    fields.find(
      (f) =>
        isIterationFieldName(f.name ?? "") ||
        (f.dataType ?? "").toUpperCase() === "ITERATION"
    ) ?? null;
  return {
    id: data.node.id,
    title: data.node.title,
    url: data.node.url,
    statusFieldId: status?.id ?? null,
    statusOptions: status?.options ?? [],
    dateFieldId: dateField?.id ?? null,
    startDateFieldId: startDateField?.id ?? null,
    priorityFieldId: priorityField?.id ?? null,
    priorityOptions: priorityField?.options ?? [],
    estimateFieldId: estimateField?.id ?? null,
    textFieldId: textField?.id ?? null,
    iterationFieldId: iterationField?.id ?? null,
    iterationOptions: iterationField?.configuration?.iterations ?? [],
  };
}

function defaultStatusMap(options: StatusOption[]): Record<string, string> {
  const map: Record<string, string> = {};
  const lower = options.map((o) => ({
    ...o,
    key: o.name.toLowerCase(),
  }));
  for (const [columnId, aliases] of Object.entries(DEFAULT_STATUS_ALIASES)) {
    const hit = lower.find((o) => aliases.includes(o.key));
    if (hit) map[columnId] = hit.id;
  }
  // Fill gaps with first unused options in order
  const used = new Set(Object.values(map));
  for (const columnId of [
    "backlog",
    "ready",
    "in_progress",
    "review",
    "done",
  ]) {
    if (map[columnId]) continue;
    const next = options.find((o) => !used.has(o.id));
    if (next) {
      map[columnId] = next.id;
      used.add(next.id);
    }
  }
  return map;
}

async function fetchProjectItems(
  accessToken: string,
  projectNodeId: string
): Promise<ProjectItem[]> {
  type ItemsPage = {
    node: {
      items: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          fieldValues: {
            nodes: Array<{
              name?: string;
              date?: string;
              text?: string;
              number?: number;
              title?: string;
              field?: { name?: string };
            }>;
          };
          content: {
            title?: string;
            body?: string;
            number?: number;
            url?: string;
            id?: string;
            repository?: { nameWithOwner?: string };
            labels?: { nodes: Array<{ name: string }> };
            assignees?: {
              nodes: Array<{
                login: string;
                name?: string | null;
                avatarUrl?: string | null;
              }>;
            };
            milestone?: {
              title: string;
              dueOn?: string | null;
              url?: string | null;
            } | null;
          } | null;
        }>;
      };
    } | null;
  };

  const items: ProjectItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data: ItemsPage = await githubGraphql<ItemsPage>(
      accessToken,
      `query($id: ID!, $cursor: String) {
        node(id: $id) {
          ... on ProjectV2 {
            items(first: 50, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                fieldValues(first: 30) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldDateValue {
                      date
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldTextValue {
                      text
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldNumberValue {
                      number
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                    ... on ProjectV2ItemFieldIterationValue {
                      title
                      field { ... on ProjectV2FieldCommon { name } }
                    }
                  }
                }
                content {
                  ... on DraftIssue { id title body }
                  ... on Issue {
                    id title body number url
                    repository { nameWithOwner }
                    labels(first: 20) { nodes { name } }
                    assignees(first: 10) {
                      nodes { login name avatarUrl }
                    }
                    milestone { title dueOn url }
                  }
                  ... on PullRequest {
                    id title body number url
                    repository { nameWithOwner }
                    labels(first: 20) { nodes { name } }
                    assignees(first: 10) {
                      nodes { login name avatarUrl }
                    }
                    milestone { title dueOn url }
                  }
                }
              }
            }
          }
        }
      }`,
      { id: projectNodeId, cursor }
    );
    const connection = data.node?.items;
    if (!connection) break;
    for (const node of connection.nodes) {
      const content = node.content;
      const title = content?.title?.trim() || "Untitled";
      const body = content?.body ?? "";
      let statusName: string | null = null;
      let dueAt: string | null = null;
      let priorityName: string | null = null;
      const extra = emptyExtraFields();
      for (const fv of node.fieldValues.nodes ?? []) {
        const fieldName = fv.field?.name ?? "";
        const fieldKey = fieldName.toLowerCase();
        if (fieldKey === "status" && fv.name) statusName = fv.name;
        if (isDueDateFieldName(fieldName) && fv.date) {
          dueAt = fv.date;
        }
        if (isStartDateFieldName(fieldName) && fv.date) {
          extra.startAt = fv.date;
        }
        if (fieldKey === "priority" && fv.name) priorityName = fv.name;
        if (isEstimateFieldName(fieldName) && typeof fv.number === "number") {
          extra.estimate = fv.number;
        }
        if (isTextNoteFieldName(fieldName) && typeof fv.text === "string") {
          extra.textNote = fv.text;
        }
        if (isIterationFieldName(fieldName) && (fv.title || fv.name)) {
          extra.iteration = String(fv.title || fv.name);
        }
      }
      const assignees: GithubAssignee[] =
        content?.assignees?.nodes?.map((a) => ({
          login: a.login,
          name: a.name ?? null,
          avatarUrl: a.avatarUrl ?? null,
        })) ?? [];
      const milestone: GithubMilestone | null = content?.milestone
        ? {
            title: content.milestone.title,
            dueOn: content.milestone.dueOn ?? null,
            url: content.milestone.url ?? null,
          }
        : null;
      items.push({
        itemId: node.id,
        title,
        body,
        statusName,
        statusOptionId: null,
        dueAt,
        priorityName,
        labels: content?.labels?.nodes?.map((l: { name: string }) => l.name) ?? [],
        assignees,
        milestone,
        url: content?.url ?? null,
        issueNumber: content?.number ?? null,
        repo: content?.repository?.nameWithOwner ?? null,
        contentId: content?.id ?? null,
        ...extra,
      });
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return items;
}

function columnForStatus(
  statusName: string | null,
  statusMap: Record<string, string>,
  options: StatusOption[]
): string {
  if (statusName) {
    const opt = options.find(
      (o) => o.name.toLowerCase() === statusName.toLowerCase()
    );
    if (opt) {
      for (const [col, optionId] of Object.entries(statusMap)) {
        if (optionId === opt.id) return col;
      }
      return slugBoardColumnId(opt.name);
    }
    for (const [col, aliases] of Object.entries(DEFAULT_STATUS_ALIASES)) {
      if (aliases.includes(statusName.toLowerCase())) return col;
    }
    const slug = slugBoardColumnId(statusName);
    if (statusMap[slug]) return slug;
  }
  return Object.keys(statusMap)[0] || "backlog";
}

function priorityFromName(name: string | null): number {
  if (!name) return 2;
  const n = name.toLowerCase().trim();
  if (/(^|[^a-z])p0([^a-z]|$)/.test(n) || n.includes("urgent") || n.includes("critical")) {
    return 0;
  }
  if (/(^|[^a-z])p1([^a-z]|$)/.test(n) || n === "high") return 1;
  if (/(^|[^a-z])p3([^a-z]|$)/.test(n) || /(^|[^a-z])p4([^a-z]|$)/.test(n) || n === "low") {
    return 3;
  }
  if (/(^|[^a-z])p2([^a-z]|$)/.test(n) || n.includes("medium") || n.includes("normal")) {
    return 2;
  }
  if (n.includes("high")) return 1;
  if (n.includes("low")) return 3;
  return 2;
}

/** Normalize legacy array context_json into an object so github + attachments coexist. */
export function normalizeCardContextObject(
  raw: string | null
): Record<string, unknown> {
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

function parseGithubContext(raw: string | null): {
  projectItemId?: string;
  [k: string]: unknown;
} {
  const base = normalizeCardContextObject(raw);
  const github = base.github;
  if (github && typeof github === "object") {
    return github as { projectItemId?: string };
  }
  return {};
}

function mergeGithubContext(
  existingRaw: string | null,
  github: Record<string, unknown>
): string {
  const base = normalizeCardContextObject(existingRaw);
  return JSON.stringify({ ...base, github });
}

function columnsFromStatusOptions(options: StatusOption[]): {
  columns: BoardColumnDef[];
  statusMap: Record<string, string>;
} {
  const used = new Set<string>();
  const columns: BoardColumnDef[] = [];
  const statusMap: Record<string, string> = {};
  options.forEach((o, i) => {
    let id = slugBoardColumnId(o.name);
    if (used.has(id)) id = `${id}_${i}`;
    used.add(id);
    columns.push({ id, name: o.name, sort_order: i });
    statusMap[id] = o.id;
  });
  return { columns, statusMap };
}

function remapCardColumnId(
  oldId: string,
  columns: BoardColumnDef[]
): string {
  if (columns.some((c) => c.id === oldId)) return oldId;
  const lower = oldId.toLowerCase().replace(/_/g, " ");
  const byName = columns.find(
    (c) =>
      c.id === oldId ||
      c.name.toLowerCase() === lower ||
      slugBoardColumnId(c.name) === oldId
  );
  if (byName) return byName.id;
  for (const [canon, aliases] of Object.entries(DEFAULT_STATUS_ALIASES)) {
    if (oldId !== canon && !aliases.includes(oldId.replace(/_/g, " "))) continue;
    const hit = columns.find((c) => {
      const n = c.name.toLowerCase();
      return (
        slugBoardColumnId(c.name) === canon ||
        n === canon.replace(/_/g, " ") ||
        aliases.includes(n)
      );
    });
    if (hit) return hit.id;
  }
  return columns[0]?.id ?? oldId;
}

export async function linkBoardToGithubProject(opts: {
  userId: string;
  db: AppDatabase;
  boardId: string;
  projectNodeId: string;
  statusMap?: Record<string, string>;
}): Promise<UserBoardRow> {
  const board = getUserBoard(opts.userId, opts.db, opts.boardId);
  if (!board || board.archived_at) {
    throw Object.assign(new Error("Board not found"), { status: 404 });
  }
  const accessToken = await requireToken(opts.db);

  // Enforce one board per GitHub Project per user
  const conflict = opts.db
    .prepare(
      `SELECT id, name FROM ai_projects
       WHERE user_id=? AND github_project_node_id=? AND id!=? AND archived_at IS NULL`
    )
    .get(opts.userId, opts.projectNodeId, opts.boardId) as
    | { id: string; name: string }
    | undefined;
  if (conflict) {
    throw Object.assign(
      new Error(
        `GitHub Project already linked to board "${conflict.name}". Unlink it first.`
      ),
      { status: 409 }
    );
  }

  const meta = await loadProjectMeta(accessToken, opts.projectNodeId);
  const fromGh = columnsFromStatusOptions(meta.statusOptions);
  const statusMap =
    opts.statusMap && Object.keys(opts.statusMap).length > 0
      ? opts.statusMap
      : fromGh.statusMap;
  const columns =
    fromGh.columns.length > 0
      ? fromGh.columns
      : ([
          { id: "backlog", name: "Backlog", sort_order: 0 },
          { id: "ready", name: "Ready", sort_order: 1 },
          { id: "in_progress", name: "In Progress", sort_order: 2 },
          { id: "review", name: "Review", sort_order: 3 },
          { id: "done", name: "Done", sort_order: 4 },
        ] satisfies BoardColumnDef[]);

  const cards = opts.db
    .prepare(`SELECT id, column_id FROM ai_project_cards WHERE project_id=?`)
    .all(opts.boardId) as Array<{ id: string; column_id: string }>;
  const updateCol = opts.db.prepare(
    `UPDATE ai_project_cards SET column_id=?, updated_at=datetime('now') WHERE id=?`
  );
  for (const card of cards) {
    const next = remapCardColumnId(card.column_id, columns);
    if (next !== card.column_id) updateCol.run(next, card.id);
  }

  opts.db
    .prepare(
      `UPDATE ai_projects SET
         github_project_node_id=?,
         github_project_url=?,
         github_status_map_json=?,
         columns_json=?,
         sync_enabled=1,
         updated_at=datetime('now')
       WHERE id=? AND user_id=?`
    )
    .run(
      meta.id,
      meta.url,
      JSON.stringify(statusMap),
      JSON.stringify(columns),
      opts.boardId,
      opts.userId
    );

  return getUserBoard(opts.userId, opts.db, opts.boardId)!;
}

export function unlinkBoardGithub(
  userId: string,
  db: AppDatabase,
  boardId: string
): UserBoardRow {
  const board = getUserBoard(userId, db, boardId);
  if (!board) throw Object.assign(new Error("Board not found"), { status: 404 });
  db.prepare(
    `UPDATE ai_projects SET
       github_project_node_id=NULL,
       github_project_url=NULL,
       github_status_map_json=NULL,
       sync_enabled=0,
       last_synced_at=NULL,
       last_sync_error=NULL,
       sync_started_at=NULL,
       last_sync_attempt_at=NULL,
       updated_at=datetime('now')
     WHERE id=? AND user_id=?`
  ).run(boardId, userId);
  return getUserBoard(userId, db, boardId)!;
}

/** Lease window: concurrent Sync/poll skip while a sync is in progress. */
export const GITHUB_SYNC_LEASE_MS = 10 * 60 * 1000;

function boardSyncInProgress(board: UserBoardRow, nowMs = Date.now()): boolean {
  if (!board.sync_started_at) return false;
  const started = Date.parse(board.sync_started_at);
  if (!Number.isFinite(started)) return true;
  return nowMs - started < GITHUB_SYNC_LEASE_MS;
}

function markGithubSyncStarted(
  db: AppDatabase,
  boardId: string,
  userId: string
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ai_projects SET
       sync_started_at=?,
       last_sync_attempt_at=?,
       updated_at=datetime('now')
     WHERE id=? AND user_id=?`
  ).run(now, now, boardId, userId);
}

function markGithubSyncSucceeded(
  db: AppDatabase,
  boardId: string,
  userId: string
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ai_projects SET
       last_synced_at=?,
       last_sync_error=NULL,
       sync_started_at=NULL,
       last_sync_attempt_at=?,
       updated_at=datetime('now')
     WHERE id=? AND user_id=?`
  ).run(now, now, boardId, userId);
}

function markGithubSyncFailed(
  db: AppDatabase,
  boardId: string,
  userId: string,
  error: unknown
): void {
  const message =
    error instanceof Error
      ? error.message.slice(0, 500)
      : String(error).slice(0, 500);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE ai_projects SET
       last_sync_error=?,
       sync_started_at=NULL,
       last_sync_attempt_at=?,
       updated_at=datetime('now')
     WHERE id=? AND user_id=?`
  ).run(message || "Sync failed", now, boardId, userId);
}

/** Boards with GitHub sync enabled (for background poll). */
export function listGithubSyncedBoards(db: AppDatabase): Array<{
  id: string;
  user_id: string;
  name: string;
  sync_started_at: string | null;
}> {
  return db
    .prepare(
      `SELECT id, user_id, name, sync_started_at FROM ai_projects
       WHERE sync_enabled=1
         AND github_project_node_id IS NOT NULL
         AND archived_at IS NULL
         AND user_id IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    user_id: string;
    name: string;
    sync_started_at: string | null;
  }>;
}

export async function syncBoardWithGithub(opts: {
  userId: string;
  db: AppDatabase;
  boardId: string;
  /** When true, skip if another sync holds the lease (used by poller). */
  skipIfBusy?: boolean;
}): Promise<{
  project: UserBoardRow;
  pulled: number;
  updated: number;
  created: number;
  skipped?: boolean;
}> {
  const board = getUserBoard(opts.userId, opts.db, opts.boardId);
  if (!board || board.archived_at) {
    throw Object.assign(new Error("Board not found"), { status: 404 });
  }
  if (!board.github_project_node_id || !board.sync_enabled) {
    throw Object.assign(
      new Error("Board is not linked to a GitHub Project"),
      { status: 400 }
    );
  }

  if (boardSyncInProgress(board)) {
    if (opts.skipIfBusy) {
      return {
        project: board,
        pulled: 0,
        updated: 0,
        created: 0,
        skipped: true,
      };
    }
    throw Object.assign(new Error("GitHub sync already in progress"), {
      status: 409,
    });
  }

  markGithubSyncStarted(opts.db, opts.boardId, opts.userId);
  try {
    const result = await pullBoardFromGithub(opts);
    markGithubSyncSucceeded(opts.db, opts.boardId, opts.userId);
    return {
      ...result,
      project: getUserBoard(opts.userId, opts.db, opts.boardId)!,
    };
  } catch (err) {
    markGithubSyncFailed(opts.db, opts.boardId, opts.userId, err);
    throw err;
  }
}

async function pullBoardFromGithub(opts: {
  userId: string;
  db: AppDatabase;
  boardId: string;
}): Promise<{
  project: UserBoardRow;
  pulled: number;
  updated: number;
  created: number;
}> {
  const board = getUserBoard(opts.userId, opts.db, opts.boardId)!;
  if (!board.github_project_node_id) {
    throw Object.assign(
      new Error("Board is not linked to a GitHub Project"),
      { status: 400 }
    );
  }

  const accessToken = await requireToken(opts.db);
  const meta = await loadProjectMeta(accessToken, board.github_project_node_id);
  const fromGh = columnsFromStatusOptions(meta.statusOptions);
  let statusMap: Record<string, string> = {};
  try {
    statusMap = board.github_status_map_json
      ? (JSON.parse(board.github_status_map_json) as Record<string, string>)
      : {};
  } catch {
    statusMap = {};
  }
  if (fromGh.columns.length > 0) {
    const prevCols = (() => {
      try {
        return board.columns_json
          ? (JSON.parse(board.columns_json) as BoardColumnDef[])
          : [];
      } catch {
        return [] as BoardColumnDef[];
      }
    })();
    const prevById = new Map(prevCols.map((c) => [c.id, c]));
    const prevByName = new Map(
      prevCols.map((c) => [c.name.toLowerCase(), c])
    );
    const mergedColumns = fromGh.columns.map((c) => {
      const prev = prevById.get(c.id) ?? prevByName.get(c.name.toLowerCase());
      return {
        ...c,
        hidden: prev?.hidden ?? false,
        wip_limit: prev?.wip_limit ?? null,
      };
    });
    statusMap = fromGh.statusMap;
    const cards = opts.db
      .prepare(`SELECT id, column_id FROM ai_project_cards WHERE project_id=?`)
      .all(opts.boardId) as Array<{ id: string; column_id: string }>;
    const updateCol = opts.db.prepare(
      `UPDATE ai_project_cards SET column_id=? WHERE id=?`
    );
    for (const card of cards) {
      const next = remapCardColumnId(card.column_id, mergedColumns);
      if (next !== card.column_id) updateCol.run(next, card.id);
    }
    opts.db
      .prepare(
        `UPDATE ai_projects SET columns_json=?, github_status_map_json=?, updated_at=datetime('now')
         WHERE id=? AND user_id=?`
      )
      .run(
        JSON.stringify(mergedColumns),
        JSON.stringify(statusMap),
        opts.boardId,
        opts.userId
      );
  } else if (Object.keys(statusMap).length === 0) {
    statusMap = defaultStatusMap(meta.statusOptions);
  }

  const items = await fetchProjectItems(
    accessToken,
    board.github_project_node_id
  );
  const existing = opts.db
    .prepare(`SELECT * FROM ai_project_cards WHERE project_id=?`)
    .all(opts.boardId) as Array<{
    id: string;
    context_json: string | null;
    title: string;
    description: string | null;
    column_id: string;
    due_at: string | null;
    priority: number;
    tags_json: string | null;
  }>;

  const byItemId = new Map<string, (typeof existing)[0]>();
  for (const card of existing) {
    const gh = parseGithubContext(card.context_json);
    if (gh.projectItemId) byItemId.set(String(gh.projectItemId), card);
  }

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const columnId = columnForStatus(
      item.statusName,
      statusMap,
      meta.statusOptions
    );
    const tagsJson = JSON.stringify(item.labels);
    const githubCtx = {
      projectItemId: item.itemId,
      contentId: item.contentId,
      issueNumber: item.issueNumber,
      repo: item.repo,
      url: item.url,
      assignees: item.assignees,
      milestone: item.milestone,
      startAt: item.startAt,
      estimate: item.estimate,
      textNote: item.textNote,
      iteration: item.iteration,
      lastSyncedAt: new Date().toISOString(),
    };
    const prev = byItemId.get(item.itemId);
    if (prev) {
      opts.db
        .prepare(
          `UPDATE ai_project_cards SET
             title=?, description=?, column_id=?, due_at=?, priority=?, tags_json=?,
             context_json=?, updated_at=datetime('now')
           WHERE id=? AND project_id=?`
        )
        .run(
          item.title,
          item.body || null,
          columnId,
          item.dueAt,
          priorityFromName(item.priorityName),
          tagsJson,
          mergeGithubContext(prev.context_json, githubCtx),
          prev.id,
          opts.boardId
        );
      updated += 1;
    } else {
      const id = uuidv4();
      const order = (
        opts.db
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) AS value
             FROM ai_project_cards WHERE project_id=? AND column_id=?`
          )
          .get(opts.boardId, columnId) as { value: number }
      ).value;
      opts.db
        .prepare(
          `INSERT INTO ai_project_cards
           (id, project_id, column_id, title, description, context_json, tags_json, due_at, priority, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          opts.boardId,
          columnId,
          item.title,
          item.body || null,
          mergeGithubContext(null, githubCtx),
          tagsJson,
          item.dueAt,
          priorityFromName(item.priorityName),
          order + 1
        );
      created += 1;
    }
  }

  // Remove GodMode cards whose Project items were archived/removed on GitHub.
  const seenItemIds = new Set(items.map((i) => i.itemId));
  let removed = 0;
  for (const card of existing) {
    const gh = parseGithubContext(card.context_json);
    if (!gh.projectItemId) continue;
    if (seenItemIds.has(String(gh.projectItemId))) continue;
    opts.db
      .prepare(`DELETE FROM ai_project_cards WHERE id=? AND project_id=?`)
      .run(card.id, opts.boardId);
    removed += 1;
  }
  void removed;

  return {
    project: getUserBoard(opts.userId, opts.db, opts.boardId)!,
    pulled: items.length,
    created,
    updated,
  };
}

type SyncedCardRow = {
  title: string;
  description: string | null;
  due_at: string | null;
  priority: number;
  tags_json: string | null;
  context_json: string | null;
  github_project_node_id: string | null;
  github_status_map_json: string | null;
  sync_enabled: number;
};

function loadSyncedCard(
  db: AppDatabase,
  userId: string,
  cardId: string
): SyncedCardRow | null {
  return (
    (db
      .prepare(
        `SELECT c.title, c.description, c.due_at, c.priority, c.tags_json, c.context_json,
                p.github_project_node_id, p.github_status_map_json, p.sync_enabled
         FROM ai_project_cards c
         JOIN ai_projects p ON p.id = c.project_id
         WHERE c.id=? AND p.user_id=?`
      )
      .get(cardId, userId) as SyncedCardRow | undefined) ?? null
  );
}

function priorityOptionId(
  priority: number,
  options: StatusOption[]
): string | null {
  if (!options.length) return null;
  const want =
    priority <= 0
      ? ["p0", "urgent", "critical"]
      : priority === 1
        ? ["p1", "high"]
        : priority >= 3
          ? ["p3", "p4", "low"]
          : ["p2", "medium", "normal", "mid"];
  const hit = options.find((o) =>
    want.some((w) => o.name.toLowerCase().includes(w))
  );
  return hit?.id ?? options[Math.min(Math.max(priority, 0), options.length - 1)]?.id ?? null;
}

async function setProjectSingleSelect(opts: {
  accessToken: string;
  projectId: string;
  itemId: string;
  fieldId: string;
  optionId: string;
}): Promise<void> {
  await githubGraphql(
    opts.accessToken,
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }`,
    {
      projectId: opts.projectId,
      itemId: opts.itemId,
      fieldId: opts.fieldId,
      optionId: opts.optionId,
    }
  );
}

/**
 * Push a card's column (Status) to GitHub after a local move.
 * Best-effort â€” failures are logged by callers.
 */
export async function pushCardColumnToGithub(opts: {
  userId: string;
  db: AppDatabase;
  cardId: string;
  columnId: string;
}): Promise<void> {
  const card = loadSyncedCard(opts.db, opts.userId, opts.cardId);
  if (!card?.sync_enabled || !card.github_project_node_id) return;
  const gh = parseGithubContext(card.context_json);
  if (!gh.projectItemId) return;

  let statusMap: Record<string, string> = {};
  try {
    statusMap = card.github_status_map_json
      ? (JSON.parse(card.github_status_map_json) as Record<string, string>)
      : {};
  } catch {
    return;
  }
  const optionId = statusMap[opts.columnId];
  if (!optionId) return;

  const accessToken = await requireToken(opts.db);
  const meta = await loadProjectMeta(accessToken, card.github_project_node_id);
  if (!meta.statusFieldId) return;

  await setProjectSingleSelect({
    accessToken,
    projectId: card.github_project_node_id,
    itemId: String(gh.projectItemId),
    fieldId: meta.statusFieldId,
    optionId,
  });
}

/**
 * Push title/body/due/priority/labels to GitHub after a local card edit.
 */
export async function pushCardFieldsToGithub(opts: {
  userId: string;
  db: AppDatabase;
  cardId: string;
}): Promise<void> {
  const card = loadSyncedCard(opts.db, opts.userId, opts.cardId);
  if (!card?.sync_enabled || !card.github_project_node_id) return;
  const gh = parseGithubContext(card.context_json) as {
    projectItemId?: string;
    contentId?: string;
    issueNumber?: number;
    repo?: string;
  };
  if (!gh.projectItemId) return;

  const accessToken = await requireToken(opts.db);
  const meta = await loadProjectMeta(accessToken, card.github_project_node_id);
  const contentId = gh.contentId ? String(gh.contentId) : null;
  const title = card.title;
  const body = card.description ?? "";

  if (contentId && gh.issueNumber != null && gh.repo) {
    await githubGraphql(
      accessToken,
      `mutation($id: ID!, $title: String!, $body: String) {
        updateIssue(input: { id: $id, title: $title, body: $body }) {
          issue { id }
        }
      }`,
      { id: contentId, title, body }
    );
    let labels: string[] = [];
    try {
      labels = card.tags_json
        ? (JSON.parse(card.tags_json) as string[])
        : [];
    } catch {
      labels = [];
    }
    if (Array.isArray(labels) && labels.length >= 0 && gh.repo.includes("/")) {
      const [owner, repo] = gh.repo.split("/");
      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${gh.issueNumber}/labels`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "GodMode",
          },
          body: JSON.stringify(labels),
        }
      ).catch(() => undefined);
    }
  } else if (contentId) {
    await githubGraphql(
      accessToken,
      `mutation($id: ID!, $title: String!, $body: String) {
        updateProjectV2DraftIssue(input: { draftIssueId: $id, title: $title, body: $body }) {
          draftIssue { id }
        }
      }`,
      { id: contentId, title, body }
    );
  }

  if (meta.dateFieldId && card.due_at) {
    const date = card.due_at.slice(0, 10);
    await githubGraphql(
      accessToken,
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { date: $date }
        }) { projectV2Item { id } }
      }`,
      {
        projectId: card.github_project_node_id,
        itemId: gh.projectItemId,
        fieldId: meta.dateFieldId,
        date,
      }
    );
  }

  const fieldGh = parseGithubContext(card.context_json) as {
    startAt?: string | null;
    estimate?: number | null;
    textNote?: string | null;
    iteration?: string | null;
  };

  if (meta.startDateFieldId && fieldGh.startAt) {
    const date = String(fieldGh.startAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      await githubGraphql(
        accessToken,
        `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { date: $date }
          }) { projectV2Item { id } }
        }`,
        {
          projectId: card.github_project_node_id,
          itemId: gh.projectItemId,
          fieldId: meta.startDateFieldId,
          date,
        }
      );
    }
  }

  if (meta.estimateFieldId && typeof fieldGh.estimate === "number") {
    await githubGraphql(
      accessToken,
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { number: $number }
        }) { projectV2Item { id } }
      }`,
      {
        projectId: card.github_project_node_id,
        itemId: gh.projectItemId,
        fieldId: meta.estimateFieldId,
        number: fieldGh.estimate,
      }
    );
  }

  if (meta.textFieldId && typeof fieldGh.textNote === "string") {
    await githubGraphql(
      accessToken,
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { text: $text }
        }) { projectV2Item { id } }
      }`,
      {
        projectId: card.github_project_node_id,
        itemId: gh.projectItemId,
        fieldId: meta.textFieldId,
        text: fieldGh.textNote,
      }
    );
  }

  if (meta.iterationFieldId && fieldGh.iteration) {
    const hit = meta.iterationOptions.find(
      (o) => o.title.toLowerCase() === String(fieldGh.iteration).toLowerCase()
    );
    if (hit) {
      await githubGraphql(
        accessToken,
        `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: ID!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { iterationId: $iterationId }
          }) { projectV2Item { id } }
        }`,
        {
          projectId: card.github_project_node_id,
          itemId: gh.projectItemId,
          fieldId: meta.iterationFieldId,
          iterationId: hit.id,
        }
      );
    }
  }

  if (meta.priorityFieldId) {
    const optionId = priorityOptionId(
      Number(card.priority ?? 2),
      meta.priorityOptions
    );
    if (optionId) {
      await setProjectSingleSelect({
        accessToken,
        projectId: card.github_project_node_id,
        itemId: String(gh.projectItemId),
        fieldId: meta.priorityFieldId,
        optionId,
      });
    }
  }

  // Assignees + milestone (Issues / PRs only).
  if (contentId && gh.issueNumber != null && gh.repo && gh.repo.includes("/")) {
    const ctxGh = parseGithubContext(card.context_json) as {
      assignees?: Array<{ login: string }>;
      milestone?: { title: string } | null;
    };
    const [owner, repo] = gh.repo.split("/");
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "GodMode",
    };

    if ("assignees" in ctxGh) {
      const logins = (ctxGh.assignees ?? [])
        .map((a) => a.login)
        .filter(Boolean);
      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${gh.issueNumber}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ assignees: logins }),
        }
      ).catch(() => undefined);
    }

    if ("milestone" in ctxGh) {
      let milestoneNumber: number | null = null;
      const title = ctxGh.milestone?.title?.trim();
      if (title) {
        const listRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/milestones?state=all&per_page=100`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "GodMode",
            },
          }
        ).catch(() => null);
        if (listRes?.ok) {
          const milestones = (await listRes.json()) as Array<{
            number: number;
            title: string;
          }>;
          const hit = milestones.find(
            (m) => m.title.toLowerCase() === title.toLowerCase()
          );
          milestoneNumber = hit?.number ?? null;
        }
      }
      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${gh.issueNumber}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ milestone: milestoneNumber }),
        }
      ).catch(() => undefined);
    }
  }
}

/**
 * Create a Draft Issue (or repo Issue) on the linked Project and store ids on the card.
 */
export async function pushCardCreateToGithub(opts: {
  userId: string;
  db: AppDatabase;
  cardId: string;
  mode: "draft" | "issue";
  repo?: string;
}): Promise<void> {
  const card = opts.db
    .prepare(
      `SELECT c.id, c.title, c.description, c.column_id, c.context_json,
              p.github_project_node_id, p.github_status_map_json, p.sync_enabled, p.user_id
       FROM ai_project_cards c
       JOIN ai_projects p ON p.id = c.project_id
       WHERE c.id=? AND p.user_id=?`
    )
    .get(opts.cardId, opts.userId) as
    | {
        id: string;
        title: string;
        description: string | null;
        column_id: string;
        context_json: string | null;
        github_project_node_id: string | null;
        github_status_map_json: string | null;
        sync_enabled: number;
      }
    | undefined;
  if (!card?.sync_enabled || !card.github_project_node_id) return;

  const existing = parseGithubContext(card.context_json);
  if (existing.projectItemId) return;

  const accessToken = await requireToken(opts.db);
  const meta = await loadProjectMeta(accessToken, card.github_project_node_id);
  const title = card.title || "Untitled";
  const body = card.description ?? "";

  let contentId: string | null = null;
  let itemId: string | null = null;
  let issueNumber: number | null = null;
  let repo: string | null = null;
  let url: string | null = null;

  if (opts.mode === "issue") {
    const repoFull = (opts.repo ?? "").trim();
    if (!repoFull.includes("/")) {
      throw Object.assign(
        new Error("github_repo required as owner/name for issue create"),
        { status: 400 }
      );
    }
    const [owner, name] = repoFull.split("/");
    const created = await githubGraphql<{
      createIssue: {
        issue: { id: string; number: number; url: string };
      };
    }>(
      accessToken,
      `mutation($repoId: ID!, $title: String!, $body: String) {
        createIssue(input: { repositoryId: $repoId, title: $title, body: $body }) {
          issue { id number url }
        }
      }`,
      {
        repoId: await resolveRepositoryId(accessToken, owner, name),
        title,
        body,
      }
    );
    contentId = created.createIssue.issue.id;
    issueNumber = created.createIssue.issue.number;
    repo = repoFull;
    url = created.createIssue.issue.url;
    const added = await githubGraphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(
      accessToken,
      `mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }`,
      { projectId: card.github_project_node_id, contentId }
    );
    itemId = added.addProjectV2ItemById.item.id;
  } else {
    const draft = await githubGraphql<{
      addProjectV2DraftIssue: {
        projectItem: { id: string; content: { id: string; title: string } };
      };
    }>(
      accessToken,
      `mutation($projectId: ID!, $title: String!, $body: String) {
        addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
          projectItem {
            id
            content {
              ... on DraftIssue { id title }
            }
          }
        }
      }`,
      { projectId: card.github_project_node_id, title, body }
    );
    itemId = draft.addProjectV2DraftIssue.projectItem.id;
    contentId = draft.addProjectV2DraftIssue.projectItem.content?.id ?? null;
  }

  if (!itemId) return;

  opts.db
    .prepare(
      `UPDATE ai_project_cards SET context_json=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      mergeGithubContext(card.context_json, {
        projectItemId: itemId,
        contentId,
        issueNumber,
        repo,
        url,
        assignees: [],
        milestone: null,
        lastSyncedAt: new Date().toISOString(),
        createdFromGodMode: true,
      }),
      opts.cardId
    );

  // Push Status to match the local column.
  let statusMap: Record<string, string> = {};
  try {
    statusMap = card.github_status_map_json
      ? (JSON.parse(card.github_status_map_json) as Record<string, string>)
      : {};
  } catch {
    statusMap = {};
  }
  const optionId = statusMap[card.column_id];
  if (meta.statusFieldId && optionId) {
    await setProjectSingleSelect({
      accessToken,
      projectId: card.github_project_node_id,
      itemId,
      fieldId: meta.statusFieldId,
      optionId,
    });
  }
}

async function resolveRepositoryId(
  accessToken: string,
  owner: string,
  name: string
): Promise<string> {
  const data = await githubGraphql<{
    repository: { id: string } | null;
  }>(
    accessToken,
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { id }
    }`,
    { owner, name }
  );
  if (!data.repository?.id) {
    throw Object.assign(new Error(`Repository ${owner}/${name} not found`), {
      status: 404,
    });
  }
  return data.repository.id;
}

/**
 * Remove the linked Project item when a GodMode card is deleted.
 * Does not delete the underlying Issue/PR; only removes it from the Project
 * (draft issues are deleted with the item).
 */
export async function pushCardDeleteToGithub(opts: {
  userId: string;
  db: AppDatabase;
  cardId: string;
  contextJson: string | null;
  projectId: string;
}): Promise<void> {
  const board = getUserBoard(opts.userId, opts.db, opts.projectId);
  if (!board?.sync_enabled || !board.github_project_node_id) return;
  const gh = parseGithubContext(opts.contextJson);
  if (!gh.projectItemId) return;
  const accessToken = await requireToken(opts.db);
  await githubGraphql(
    accessToken,
    `mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
        deletedItemId
      }
    }`,
    {
      projectId: board.github_project_node_id,
      itemId: String(gh.projectItemId),
    }
  ).catch((err) => {
    // Item may already be gone on GitHub.
    console.warn("[github-projects] deleteProjectV2Item", err);
  });
}

/**
 * Archive the linked Project item (keeps Issue/PR). Caller removes the local card.
 */
export async function pushCardArchiveToGithub(opts: {
  userId: string;
  db: AppDatabase;
  contextJson: string | null;
  projectId: string;
}): Promise<{ archived: boolean }> {
  const board = getUserBoard(opts.userId, opts.db, opts.projectId);
  if (!board?.sync_enabled || !board.github_project_node_id) {
    return { archived: false };
  }
  const gh = parseGithubContext(opts.contextJson);
  if (!gh.projectItemId) return { archived: false };
  const accessToken = await requireToken(opts.db);
  try {
    await githubGraphql(
      accessToken,
      `mutation($projectId: ID!, $itemId: ID!) {
        archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
          item { id }
        }
      }`,
      {
        projectId: board.github_project_node_id,
        itemId: String(gh.projectItemId),
      }
    );
    return { archived: true };
  } catch (err) {
    console.warn("[github-projects] archiveProjectV2Item", err);
    throw err;
  }
}

export function updateBoardStatusMap(
  userId: string,
  db: AppDatabase,
  boardId: string,
  statusMap: Record<string, string>
): UserBoardRow {
  const board = getUserBoard(userId, db, boardId);
  if (!board || board.archived_at) {
    throw Object.assign(new Error("Board not found"), { status: 404 });
  }
  if (!board.github_project_node_id || !board.sync_enabled) {
    throw Object.assign(
      new Error("Board is not linked to a GitHub Project"),
      { status: 400 }
    );
  }
  db.prepare(
    `UPDATE ai_projects SET github_status_map_json=?, updated_at=datetime('now')
     WHERE id=? AND user_id=?`
  ).run(JSON.stringify(statusMap), boardId, userId);
  return getUserBoard(userId, db, boardId)!;
}

export async function getGithubProjectMetaForUser(
  userId: string,
  db: AppDatabase,
  projectNodeId: string
): Promise<{
  id: string;
  title: string;
  url: string;
  statusOptions: StatusOption[];
  statusFieldId: string | null;
  defaultStatusMap: Record<string, string>;
}> {
  void userId;
  const accessToken = await requireToken(db);
  const meta = await loadProjectMeta(accessToken, projectNodeId);
  return {
    id: meta.id,
    title: meta.title,
    url: meta.url,
    statusOptions: meta.statusOptions,
    statusFieldId: meta.statusFieldId,
    defaultStatusMap: defaultStatusMap(meta.statusOptions),
  };
}

export type GithubIssueComment = {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  authorLogin: string;
  authorAvatarUrl: string | null;
};

export type GithubIssueRef = {
  repo: string;
  owner: string;
  name: string;
  issueNumber: number;
  url: string | null;
};

/** Resolve owner/repo + issue number from a TaskCard context_json github blob. */
export function resolveGithubIssueRef(
  contextJson: string | null
): GithubIssueRef | null {
  const gh = parseGithubContext(contextJson);
  const repo = typeof gh.repo === "string" ? gh.repo.trim() : "";
  const issueNumber =
    typeof gh.issueNumber === "number" && Number.isFinite(gh.issueNumber)
      ? Math.floor(gh.issueNumber)
      : null;
  if (!repo.includes("/") || issueNumber == null || issueNumber <= 0) {
    return null;
  }
  const [owner, name] = repo.split("/", 2);
  if (!owner || !name) return null;
  const url = typeof gh.url === "string" ? gh.url : null;
  return { repo, owner, name, issueNumber, url };
}

function mapRestIssueComment(raw: {
  id?: number;
  body?: string | null;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  user?: { login?: string; avatar_url?: string | null } | null;
}): GithubIssueComment | null {
  if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) return null;
  return {
    id: raw.id,
    body: typeof raw.body === "string" ? raw.body : "",
    createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : "",
    url: typeof raw.html_url === "string" ? raw.html_url : "",
    authorLogin: raw.user?.login?.trim() || "unknown",
    authorAvatarUrl:
      typeof raw.user?.avatar_url === "string" ? raw.user.avatar_url : null,
  };
}

async function loadOwnedCardGithubContext(
  cardId: string,
  userId: string,
  db: AppDatabase
): Promise<{ context_json: string | null }> {
  const card = db
    .prepare(
      `SELECT c.context_json FROM ai_project_cards c
       JOIN ai_projects p ON p.id = c.project_id
       WHERE c.id=? AND p.user_id=?`
    )
    .get(cardId, userId) as { context_json: string | null } | undefined;
  if (!card) {
    throw Object.assign(new Error("Card not found"), { status: 404 });
  }
  return card;
}

/**
 * List GitHub Issue comments for a linked Issue/PR TaskCard.
 * Draft Project items (no issue number) return linked:false.
 */
export async function listGithubIssueCommentsForCard(opts: {
  userId: string;
  db: AppDatabase;
  cardId: string;
}): Promise<{
  linked: boolean;
  repo: string | null;
  issueNumber: number | null;
  url: string | null;
  comments: GithubIssueComment[];
}> {
  const card = await loadOwnedCardGithubContext(
    opts.cardId,
    opts.userId,
    opts.db
  );
  const ref = resolveGithubIssueRef(card.context_json);
  if (!ref) {
    return {
      linked: false,
      repo: null,
      issueNumber: null,
      url: null,
      comments: [],
    };
  }
  const accessToken = await requireToken(opts.db);
  const comments: GithubIssueComment[] = [];
  let page = 1;
  while (page <= 10) {
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues/${ref.issueNumber}/comments`
    );
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "GodMode",
      },
    });
    if (!res.ok) {
      const status = res.status === 401 || res.status === 403 ? 403 : 502;
      throw Object.assign(
        new Error(`GitHub comments list failed (${res.status})`),
        { status }
      );
    }
    const batch = (await res.json()) as Array<Parameters<typeof mapRestIssueComment>[0]>;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const row of batch) {
      const mapped = mapRestIssueComment(row);
      if (mapped) comments.push(mapped);
    }
    if (batch.length < 100) break;
    page += 1;
  }
  return {
    linked: true,
    repo: ref.repo,
    issueNumber: ref.issueNumber,
    url: ref.url,
    comments,
  };
}

/** Post a GitHub Issue comment on a linked Issue/PR TaskCard. */
export async function postGithubIssueCommentForCard(opts: {
  userId: string;
  db: AppDatabase;
  cardId: string;
  body: string;
}): Promise<GithubIssueComment> {
  const text = opts.body.trim();
  if (!text) {
    throw Object.assign(new Error("Comment body required"), { status: 400 });
  }
  const card = await loadOwnedCardGithubContext(
    opts.cardId,
    opts.userId,
    opts.db
  );
  const ref = resolveGithubIssueRef(card.context_json);
  if (!ref) {
    throw Object.assign(
      new Error("Card is not linked to a GitHub Issue or Pull Request"),
      { status: 400 }
    );
  }
  const accessToken = await requireToken(opts.db);
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues/${ref.issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "GodMode",
      },
      body: JSON.stringify({ body: text }),
    }
  );
  if (!res.ok) {
    const status = res.status === 401 || res.status === 403 ? 403 : 502;
    let detail = `GitHub comment create failed (${res.status})`;
    try {
      const errJson = (await res.json()) as { message?: string };
      if (errJson.message) detail = errJson.message;
    } catch {
      /* keep default */
    }
    throw Object.assign(new Error(detail), { status });
  }
  const raw = (await res.json()) as Parameters<typeof mapRestIssueComment>[0];
  const mapped = mapRestIssueComment(raw);
  if (!mapped) {
    throw Object.assign(new Error("GitHub returned an invalid comment"), {
      status: 502,
    });
  }
  return mapped;
}

export { userProjectId, defaultStatusMap, loadProjectMeta };
