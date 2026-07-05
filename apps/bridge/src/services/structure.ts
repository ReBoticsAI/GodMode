import type { AppDatabase } from "../db.js";
import { getAgent } from "./agents/agents-db.js";
import {
  parseTabsJson,
  tabsJsonForKind,
  type GroupTabDef,
} from "./group-tab-definitions.js";

export interface StructureNode {
  id: string;
  parentId: string | null;
  label: string;
  icon: string;
  segment: string;
  path: string;
  kind: string;
  rightSidebar: string | null;
  agentId: string | null;
  builtIn: boolean;
  sortOrder: number;
  /** In-page tabs for group kinds (from tabs_json). */
  tabs: GroupTabDef[] | null;
  children: StructureNode[];
}

export interface StructureTree {
  nodes: StructureNode[];
}

/** @deprecated Legacy shape — use StructureTree.nodes */
export interface DepartmentRow {
  id: string;
  label: string;
  icon: string;
  basePath: string;
  builtIn: boolean;
  sortOrder: number;
  divisions: DivisionRow[];
}

/** @deprecated Legacy shape */
export interface DivisionRow {
  id: string;
  departmentId: string;
  label: string;
  icon: string;
  basePath: string;
  rightSidebar: string | null;
  builtIn: boolean;
  sortOrder: number;
  pages: PageRow[];
}

/** @deprecated Legacy shape */
export interface PageRow {
  id: string;
  divisionId: string;
  departmentId: string;
  label: string;
  icon: string;
  segment: string;
  pageKind: string;
  builtIn: boolean;
  sortOrder: number;
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_RE.test(value);
}

interface DbNode {
  id: string;
  parent_id: string | null;
  label: string;
  icon: string;
  segment: string;
  kind: string;
  right_sidebar: string | null;
  agent_id: string | null;
  built_in: number;
  sort_order: number;
  tabs_json: string | null;
}

export class StructureError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const validIcon = (s: unknown): s is string =>
  typeof s === "string" && /^[a-z0-9-]+$/.test(s) && s.length <= 64;

function parseRightSidebar(raw: string | null): string | null {
  if (!raw || raw === "none") return null;
  return raw;
}

function normalizeRightSidebarInput(
  value: string | null | undefined
): string | null {
  if (value == null || value === "none" || value === "") return null;
  return String(value);
}

function computePath(
  node: DbNode,
  byId: Map<string, DbNode>
): string {
  const segments: string[] = [];
  let current: DbNode | undefined = node;
  while (current) {
    if (current.segment) segments.unshift(current.segment);
    current = current.parent_id
      ? byId.get(current.parent_id)
      : undefined;
  }
  return segments.length ? `/${segments.join("/")}` : "/";
}

function buildTree(rows: DbNode[]): StructureNode[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenByParent = new Map<string | null, DbNode[]>();
  for (const row of rows) {
    const key = row.parent_id;
    const list = childrenByParent.get(key) ?? [];
    list.push(row);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  }

  const toNode = (row: DbNode): StructureNode => ({
    id: row.id,
    parentId: row.parent_id,
    label: row.label,
    icon: row.icon,
    segment: row.segment,
    path: computePath(row, byId),
    kind: row.kind,
    rightSidebar: parseRightSidebar(row.right_sidebar),
    agentId: row.agent_id,
    builtIn: row.built_in === 1,
    sortOrder: row.sort_order,
    tabs: parseTabsJson(row.tabs_json),
    children: (childrenByParent.get(row.id) ?? []).map(toNode),
  });

  return (childrenByParent.get(null) ?? []).map(toNode);
}

export function flattenStructureNodes(nodes: StructureNode[]): StructureNode[] {
  const out: StructureNode[] = [];
  const walk = (list: StructureNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function readStructure(db: AppDatabase): StructureTree {
  const rows = db
    .prepare(
      `SELECT id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json
       FROM structure_nodes ORDER BY sort_order, label`
    )
    .all() as DbNode[];
  return { nodes: buildTree(rows) };
}

export function resolveAgentForNode(
  db: AppDatabase,
  nodeId: string | null | undefined
): string {
  if (!nodeId) return "intelligence";
  const row = db
    .prepare(`SELECT agent_id FROM structure_nodes WHERE id=?`)
    .get(nodeId) as { agent_id: string | null } | undefined;
  return row?.agent_id?.trim() || "intelligence";
}

export function resolveRightSidebarForNode(
  db: AppDatabase,
  nodeId: string
): string | null {
  let current = db
    .prepare(`SELECT id, parent_id, right_sidebar FROM structure_nodes WHERE id=?`)
    .get(nodeId) as
    | { id: string; parent_id: string | null; right_sidebar: string | null }
    | undefined;
  while (current) {
    const rs = parseRightSidebar(current.right_sidebar);
    if (rs) return rs;
    current = current.parent_id
      ? (db
          .prepare(
            `SELECT id, parent_id, right_sidebar FROM structure_nodes WHERE id=?`
          )
          .get(current.parent_id) as typeof current)
      : undefined;
  }
  return null;
}

export function createNode(
  db: AppDatabase,
  input: {
    id: string;
    parentId?: string | null;
    label: string;
    icon: string;
    segment?: string;
    kind?: string;
    rightSidebar?: string | null;
  }
): StructureNode {
  if (!isValidSlug(input.id)) {
    throw new StructureError(400, "id must be lowercase letters, digits, or hyphens");
  }
  if (typeof input.label !== "string" || input.label.trim().length === 0) {
    throw new StructureError(400, "label required");
  }
  if (!validIcon(input.icon)) throw new StructureError(400, "invalid icon");

  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = db
      .prepare(`SELECT id FROM structure_nodes WHERE id=?`)
      .get(parentId);
    if (!parent) throw new StructureError(404, "parent page not found");
  }

  const nodeId = parentId ? `${parentId}-${input.id}` : input.id;
  if (db.prepare(`SELECT id FROM structure_nodes WHERE id=?`).get(nodeId)) {
    throw new StructureError(409, "page already exists");
  }

  const segment =
    input.segment ??
    (parentId ? input.id : input.id);
  if (typeof segment !== "string" || !/^[a-z0-9-]*$/.test(segment)) {
    throw new StructureError(400, "invalid segment");
  }

  const kind = input.kind?.trim() || "placeholder";
  const rightSidebar = normalizeRightSidebarInput(input.rightSidebar);

  const sortOrder =
    ((db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM structure_nodes WHERE parent_id IS ?`
      )
      .get(parentId) as { m: number }).m ?? -1) + 1;

  db.prepare(
    `INSERT INTO structure_nodes
       (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`
  ).run(
    nodeId,
    parentId,
    input.label.trim(),
    input.icon,
    segment,
    kind,
    rightSidebar,
    sortOrder
  );

  const tree = readStructure(db);
  const flat = flattenStructureNodes(tree.nodes);
  const created = flat.find((n) => n.id === nodeId);
  if (!created) throw new StructureError(500, "failed to read created page");
  return created;
}

export function updateNode(
  db: AppDatabase,
  id: string,
  patch: {
    label?: string;
    icon?: string;
    segment?: string;
    kind?: string;
    rightSidebar?: string | null;
    parentId?: string | null;
  }
): void {
  const row = db
    .prepare(`SELECT built_in FROM structure_nodes WHERE id=?`)
    .get(id) as { built_in: number } | undefined;
  if (!row) throw new StructureError(404, "page not found");
  const isBuiltIn = row.built_in === 1;

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.parentId !== undefined) {
    const newParentId = patch.parentId === null ? null : String(patch.parentId);
    if (newParentId === id) {
      throw new StructureError(400, "a page cannot be its own parent");
    }
    if (newParentId) {
      const parent = db
        .prepare(`SELECT id FROM structure_nodes WHERE id=?`)
        .get(newParentId);
      if (!parent) throw new StructureError(404, "parent page not found");
      // Walk up from the new parent; hitting this node would create a cycle.
      let cursor: string | null = newParentId;
      while (cursor) {
        if (cursor === id) {
          throw new StructureError(400, "a page cannot be moved under its own descendant");
        }
        const up = db
          .prepare(`SELECT parent_id FROM structure_nodes WHERE id=?`)
          .get(cursor) as { parent_id: string | null } | undefined;
        cursor = up?.parent_id ?? null;
      }
    }
    const sortOrder =
      ((db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) AS m FROM structure_nodes WHERE parent_id IS ?`
        )
        .get(newParentId) as { m: number }).m ?? -1) + 1;
    sets.push("parent_id=?");
    vals.push(newParentId);
    sets.push("sort_order=?");
    vals.push(sortOrder);
  }
  if (patch.label !== undefined) {
    if (typeof patch.label !== "string" || patch.label.trim().length === 0) {
      throw new StructureError(400, "label required");
    }
    sets.push("label=?");
    vals.push(patch.label.trim());
  }
  if (patch.icon !== undefined) {
    if (!validIcon(patch.icon)) throw new StructureError(400, "invalid icon");
    sets.push("icon=?");
    vals.push(patch.icon);
  }
  if (patch.segment !== undefined) {
    if (isBuiltIn) {
      throw new StructureError(409, "segment is locked for built-in pages");
    }
    if (typeof patch.segment !== "string" || !/^[a-z0-9-]*$/.test(patch.segment)) {
      throw new StructureError(400, "invalid segment");
    }
    sets.push("segment=?");
    vals.push(patch.segment);
  }
  if (patch.kind !== undefined) {
    sets.push("kind=?");
    vals.push(patch.kind.trim() || "placeholder");
  }
  if (patch.rightSidebar !== undefined) {
    sets.push("right_sidebar=?");
    vals.push(normalizeRightSidebarInput(patch.rightSidebar));
  }
  if (sets.length === 0) return;
  sets.push("updated_at=datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE structure_nodes SET ${sets.join(", ")} WHERE id=?`).run(...vals);
}

export function deleteNode(db: AppDatabase, id: string): void {
  const row = db
    .prepare(`SELECT built_in FROM structure_nodes WHERE id=?`)
    .get(id) as { built_in: number } | undefined;
  if (!row) throw new StructureError(404, "page not found");
  if (row.built_in === 1) {
    throw new StructureError(409, "built-in pages cannot be deleted");
  }
  db.prepare(`DELETE FROM structure_nodes WHERE id=?`).run(id);
}

export function reorderNodes(
  db: AppDatabase,
  parentId: string | null,
  orderedIds: string[]
): void {
  if (!Array.isArray(orderedIds)) {
    throw new StructureError(400, "orderedIds must be an array");
  }
  const apply = db.transaction(() => {
    const stmt = db.prepare(
      `UPDATE structure_nodes SET sort_order=? WHERE id=? AND parent_id IS ?`
    );
    orderedIds.forEach((nodeId, i) => stmt.run(i, nodeId, parentId));
  });
  apply();
}

export function setNodeAgent(
  db: AppDatabase,
  nodeId: string,
  agentId: string | null
): void {
  const row = db
    .prepare(`SELECT id FROM structure_nodes WHERE id=?`)
    .get(nodeId);
  if (!row) throw new StructureError(404, "page not found");

  const normalized = typeof agentId === "string" ? agentId.trim() : "";
  if (normalized && !getAgent(db, normalized)) {
    throw new StructureError(404, "agent not found");
  }

  db.prepare(
    `UPDATE structure_nodes SET agent_id=?, updated_at=datetime('now') WHERE id=?`
  ).run(normalized || null, nodeId);
}

export function upsertNode(
  db: AppDatabase,
  row: {
    id: string;
    parentId: string | null;
    label: string;
    icon: string;
    segment: string;
    kind: string;
    rightSidebar: string | null;
    sortOrder: number;
  }
): void {
  const tabsJson = tabsJsonForKind(row.kind);
  db.prepare(
    `INSERT OR IGNORE INTO structure_nodes
       (id, parent_id, label, icon, segment, kind, right_sidebar, agent_id, built_in, sort_order, tabs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`
  ).run(
    row.id,
    row.parentId,
    row.label,
    row.icon,
    row.segment,
    row.kind,
    row.rightSidebar,
    row.sortOrder,
    tabsJson
  );
  db.prepare(
    `UPDATE structure_nodes SET label=?, icon=?, segment=?, kind=?, right_sidebar=?, built_in=1, sort_order=?, tabs_json=COALESCE(?, tabs_json), updated_at=datetime('now') WHERE id=?`
  ).run(
    row.label,
    row.icon,
    row.segment,
    row.kind,
    row.rightSidebar,
    row.sortOrder,
    tabsJson,
    row.id
  );
}

/** Idempotent built-in seed for operator tenants (personal OS: empty structure tree). */
export function ensureBuiltInStructure(db: AppDatabase): void {
  const pruneSubtree = db.prepare(
    `DELETE FROM structure_nodes WHERE id=? OR parent_id=? OR parent_id LIKE ?`
  );

  const deprecatedRoots = ["brick-and-mortar", "real-estate", "freelance"];
  for (const id of deprecatedRoots) {
    pruneSubtree.run(id, id, `${id}-%`);
    db.prepare(`DELETE FROM structure_nodes WHERE id=?`).run(id);
  }

  // Domain-specific structure trees are provisioned by optional plugins
  // via tenant:install — core ships personal OS with an empty structure tree.
}

/* Legacy aliases for transitional imports */
export function createDepartment(
  db: AppDatabase,
  input: { id: string; label: string; icon: string }
): DepartmentRow {
  const node = createNode(db, { ...input, parentId: null });
  return legacyDeptFromNode(node);
}

export function createDivision(
  db: AppDatabase,
  departmentId: string,
  input: {
    id: string;
    label: string;
    icon: string;
    rightSidebar?: string | null;
  }
): DivisionRow {
  const node = createNode(db, {
    id: input.id,
    parentId: departmentId,
    label: input.label,
    icon: input.icon,
    rightSidebar: input.rightSidebar,
  });
  return legacyDivFromNode(node, departmentId);
}

export function createPage(
  db: AppDatabase,
  departmentId: string,
  divisionId: string,
  input: { id: string; label: string; icon: string; segment: string }
): PageRow {
  const parentId = `${departmentId}-${divisionId}`;
  const node = createNode(db, {
    id: input.id,
    parentId,
    label: input.label,
    icon: input.icon,
    segment: input.segment,
  });
  return legacyPageFromNode(node, departmentId, divisionId);
}

export function updateDepartment(
  db: AppDatabase,
  id: string,
  patch: { label?: string; icon?: string }
): void {
  updateNode(db, id, patch);
}

export function updateDivision(
  db: AppDatabase,
  departmentId: string,
  id: string,
  patch: {
    label?: string;
    icon?: string;
    rightSidebar?: string | null;
  }
): void {
  updateNode(db, `${departmentId}-${id}`, patch);
}

export function updatePage(
  db: AppDatabase,
  departmentId: string,
  divisionId: string,
  id: string,
  patch: { label?: string; icon?: string; segment?: string }
): void {
  updateNode(db, `${departmentId}-${divisionId}-${id}`, patch);
}

export function deleteDepartment(db: AppDatabase, id: string): void {
  deleteNode(db, id);
}

export function deleteDivision(
  db: AppDatabase,
  departmentId: string,
  id: string
): void {
  deleteNode(db, `${departmentId}-${id}`);
}

export function deletePage(
  db: AppDatabase,
  departmentId: string,
  divisionId: string,
  id: string
): void {
  deleteNode(db, `${departmentId}-${divisionId}-${id}`);
}

export type ReorderKind = "department" | "division" | "page";

export function reorder(
  db: AppDatabase,
  kind: ReorderKind,
  parent: { departmentId?: string; divisionId?: string },
  orderedIds: string[]
): void {
  if (kind === "department") {
    reorderNodes(db, null, orderedIds);
    return;
  }
  if (kind === "division") {
    if (!parent.departmentId) throw new StructureError(400, "departmentId required");
    reorderNodes(db, parent.departmentId, orderedIds.map((id) => `${parent.departmentId}-${id}`));
    return;
  }
  if (!parent.departmentId || !parent.divisionId) {
    throw new StructureError(400, "departmentId and divisionId required");
  }
  const prefix = `${parent.departmentId}-${parent.divisionId}-`;
  reorderNodes(
    db,
    `${parent.departmentId}-${parent.divisionId}`,
    orderedIds.map((id) => `${prefix}${id}`)
  );
}

function legacyDeptFromNode(node: StructureNode): DepartmentRow {
  return {
    id: node.id,
    label: node.label,
    icon: node.icon,
    basePath: node.path,
    builtIn: node.builtIn,
    sortOrder: node.sortOrder,
    divisions: node.children.map((c) => legacyDivFromNode(c, node.id)),
  };
}

function legacyDivFromNode(node: StructureNode, departmentId: string): DivisionRow {
  return {
    id: node.segment,
    departmentId,
    label: node.label,
    icon: node.icon,
    basePath: node.path,
    rightSidebar: node.rightSidebar,
    builtIn: node.builtIn,
    sortOrder: node.sortOrder,
    pages: node.children.map((p) => legacyPageFromNode(p, departmentId, node.segment)),
  };
}

function legacyPageFromNode(
  node: StructureNode,
  departmentId: string,
  divisionId: string
): PageRow {
  const pageId = node.id.startsWith(`${departmentId}-${divisionId}-`)
    ? node.id.slice(`${departmentId}-${divisionId}-`.length)
    : node.segment;
  return {
    id: pageId,
    divisionId,
    departmentId,
    label: node.label,
    icon: node.icon,
    segment: node.segment,
    pageKind: node.kind,
    builtIn: node.builtIn,
    sortOrder: node.sortOrder,
  };
}

/** Convert recursive nodes to legacy departments tree for gradual frontend migration. */
export function structureNodesToLegacy(tree: StructureTree): { departments: DepartmentRow[] } {
  return {
    departments: tree.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      icon: n.icon,
      basePath: n.path,
      builtIn: n.builtIn,
      sortOrder: n.sortOrder,
      divisions: n.children.map((c) => legacyDivFromNode(c, n.id)),
    })),
  };
}
