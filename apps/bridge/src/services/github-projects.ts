/**
 * GitHub Projects (v2) list + board sync into GodMode TaskCards.
 */
import { v4 as uuidv4 } from "uuid";
import type { AppDatabase } from "../db.js";
import {
  getUserBoard,
  type UserBoardRow,
  userProjectId,
} from "./user-productivity.js";
import { readGithubProjectsToken } from "./github-integration.js";

export type GithubProjectSummary = {
  id: string;
  title: string;
  url: string;
  number: number;
  owner: string;
};

type StatusOption = { id: string; name: string };

type ProjectMeta = {
  id: string;
  title: string;
  url: string;
  statusFieldId: string | null;
  statusOptions: StatusOption[];
  dateFieldId: string | null;
  priorityFieldId: string | null;
  priorityOptions: StatusOption[];
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
  url: string | null;
  issueNumber: number | null;
  repo: string | null;
  contentId: string | null;
};

const DEFAULT_STATUS_ALIASES: Record<string, string[]> = {
  backlog: ["todo", "backlog", "ready", "new", "triage"],
  in_progress: ["in progress", "in_progress", "doing", "active", "wip"],
  review: ["in review", "review", "needs review", "waiting"],
  done: ["done", "complete", "completed", "closed", "finished"],
};

function requireToken(db: AppDatabase): string {
  const token = readGithubProjectsToken(db);
  if (!token?.accessToken) {
    throw Object.assign(
      new Error("Connect GitHub in Settings before linking a Project"),
      { status: 400 }
    );
  }
  return token.accessToken;
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

export async function listGithubProjectsForUser(
  _userId: string,
  db: AppDatabase
): Promise<GithubProjectSummary[]> {
  const accessToken = requireToken(db);
  const data = await githubGraphql<{
    viewer: {
      login: string;
      projectsV2: {
        nodes: Array<{
          id: string;
          title: string;
          number: number;
          url: string;
        }>;
      };
      organizations: {
        nodes: Array<{
          login: string;
          projectsV2: {
            nodes: Array<{
              id: string;
              title: string;
              number: number;
              url: string;
            }>;
          };
        }>;
      };
    };
  }>(
    accessToken,
    `query {
      viewer {
        login
        projectsV2(first: 40) {
          nodes { id title number url }
        }
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
  const out: GithubProjectSummary[] = [];
  for (const p of data.viewer.projectsV2.nodes ?? []) {
    out.push({
      id: p.id,
      title: p.title,
      url: p.url,
      number: p.number,
      owner: data.viewer.login,
    });
  }
  for (const org of data.viewer.organizations.nodes ?? []) {
    for (const p of org.projectsV2.nodes ?? []) {
      out.push({
        id: p.id,
        title: p.title,
        url: p.url,
        number: p.number,
        owner: org.login,
      });
    }
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
    fields.find((f) =>
      ["target date", "due date", "due", "date"].includes(
        (f.name ?? "").toLowerCase()
      )
    ) ?? null;
  const priorityField =
    fields.find((f) => (f.name ?? "").toLowerCase() === "priority" && f.options) ??
    null;
  return {
    id: data.node.id,
    title: data.node.title,
    url: data.node.url,
    statusFieldId: status?.id ?? null,
    statusOptions: status?.options ?? [],
    dateFieldId: dateField?.id ?? null,
    priorityFieldId: priorityField?.id ?? null,
    priorityOptions: priorityField?.options ?? [],
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
  for (const columnId of ["backlog", "in_progress", "review", "done"]) {
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
                fieldValues(first: 20) {
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
                  }
                }
                content {
                  ... on DraftIssue { id title body }
                  ... on Issue {
                    id title body number url
                    repository { nameWithOwner }
                    labels(first: 20) { nodes { name } }
                  }
                  ... on PullRequest {
                    id title body number url
                    repository { nameWithOwner }
                    labels(first: 20) { nodes { name } }
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
      for (const fv of node.fieldValues.nodes ?? []) {
        const fieldName = (fv.field?.name ?? "").toLowerCase();
        if (fieldName === "status" && fv.name) statusName = fv.name;
        if (
          ["target date", "due date", "due", "date"].includes(fieldName) &&
          fv.date
        ) {
          dueAt = fv.date;
        }
        if (fieldName === "priority" && fv.name) priorityName = fv.name;
      }
      items.push({
        itemId: node.id,
        title,
        body,
        statusName,
        statusOptionId: null,
        dueAt,
        priorityName,
        labels: content?.labels?.nodes?.map((l: { name: string }) => l.name) ?? [],
        url: content?.url ?? null,
        issueNumber: content?.number ?? null,
        repo: content?.repository?.nameWithOwner ?? null,
        contentId: content?.id ?? null,
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
    }
    for (const [col, aliases] of Object.entries(DEFAULT_STATUS_ALIASES)) {
      if (aliases.includes(statusName.toLowerCase())) return col;
    }
  }
  return "backlog";
}

function priorityFromName(name: string | null): number {
  if (!name) return 2;
  const n = name.toLowerCase();
  if (n.includes("high") || n.includes("p0") || n.includes("urgent")) return 1;
  if (n.includes("low") || n.includes("p3") || n.includes("p4")) return 3;
  return 2;
}

function parseGithubContext(raw: string | null): {
  projectItemId?: string;
  [k: string]: unknown;
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { github?: Record<string, unknown> };
    return (parsed.github as { projectItemId?: string }) ?? {};
  } catch {
    return {};
  }
}

function mergeGithubContext(
  existingRaw: string | null,
  github: Record<string, unknown>
): string {
  let base: Record<string, unknown> = {};
  if (existingRaw) {
    try {
      base = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, github });
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
  const accessToken = requireToken(opts.db);

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
  const statusMap =
    opts.statusMap && Object.keys(opts.statusMap).length > 0
      ? opts.statusMap
      : defaultStatusMap(meta.statusOptions);

  opts.db
    .prepare(
      `UPDATE ai_projects SET
         github_project_node_id=?,
         github_project_url=?,
         github_status_map_json=?,
         sync_enabled=1,
         updated_at=datetime('now')
       WHERE id=? AND user_id=?`
    )
    .run(
      meta.id,
      meta.url,
      JSON.stringify(statusMap),
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
       updated_at=datetime('now')
     WHERE id=? AND user_id=?`
  ).run(boardId, userId);
  return getUserBoard(userId, db, boardId)!;
}

export async function syncBoardWithGithub(opts: {
  userId: string;
  db: AppDatabase;
  boardId: string;
}): Promise<{
  project: UserBoardRow;
  pulled: number;
  updated: number;
  created: number;
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

  const accessToken = requireToken(opts.db);
  const meta = await loadProjectMeta(accessToken, board.github_project_node_id);
  let statusMap: Record<string, string> = {};
  try {
    statusMap = board.github_status_map_json
      ? (JSON.parse(board.github_status_map_json) as Record<string, string>)
      : {};
  } catch {
    statusMap = {};
  }
  if (Object.keys(statusMap).length === 0) {
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

  opts.db
    .prepare(
      `UPDATE ai_projects SET last_synced_at=datetime('now'), updated_at=datetime('now')
       WHERE id=? AND user_id=?`
    )
    .run(opts.boardId, opts.userId);

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
    priority <= 1 ? ["high", "urgent", "p0", "p1"] : priority >= 3 ? ["low", "p3", "p4"] : ["medium", "normal", "p2", "mid"];
  const hit = options.find((o) =>
    want.some((w) => o.name.toLowerCase().includes(w))
  );
  return hit?.id ?? options[Math.min(1, options.length - 1)]?.id ?? null;
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
 * Best-effort — failures are logged by callers.
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

  const accessToken = requireToken(opts.db);
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

  const accessToken = requireToken(opts.db);
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
  const accessToken = requireToken(db);
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

export { userProjectId, defaultStatusMap, loadProjectMeta };
