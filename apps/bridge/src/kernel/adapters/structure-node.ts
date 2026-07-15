import type { AppDatabase } from "../../db.js";
import type { ListRecordsResult, RecordData, RecordRow } from "@godmode/kernel";
import {
  createNode,
  deleteNode,
  flattenStructureNodes,
  readStructure,
  reorderNodes,
  setNodeAgent,
  StructureError,
  updateNode,
} from "../../services/structure.js";
import type { RecordAdapter } from "../adapter-registry.js";

function nodeToRecord(n: {
  id: string;
  parentId: string | null;
  label: string;
  icon: string;
  segment: string;
  path: string;
  kind: string;
  objectType: string | null;
  rightSidebar: string | null;
  agentId: string | null;
  builtIn: boolean;
  sortOrder: number;
  tabs: unknown;
}): RecordRow {
  return {
    id: n.id,
    objectType: "StructureNode",
    data: {
      id: n.id,
      parent_id: n.parentId,
      label: n.label,
      icon: n.icon,
      segment: n.segment,
      kind: n.kind,
      object_type: n.objectType,
      right_sidebar: n.rightSidebar,
      agent_id: n.agentId,
      built_in: n.builtIn,
      sort_order: n.sortOrder,
      tabs_json: n.tabs,
      path: n.path,
    },
  };
}

export function listStructureNodeRecords(
  db: AppDatabase,
  opts?: { parentId?: string | null; limit?: number; offset?: number }
): ListRecordsResult {
  const flat = flattenStructureNodes(readStructure(db).nodes);
  let rows = flat.map(nodeToRecord);
  if (opts && "parentId" in (opts ?? {})) {
    const pid = opts?.parentId ?? null;
    rows = rows.filter((r) => (r.data.parent_id ?? null) === pid);
  }
  const limit = opts?.limit;
  const offset = Math.max(Number(opts?.offset) || 0, 0);
  const total = rows.length;
  rows = rows.slice(offset, limit != null && limit > 0 ? offset + limit : undefined);
  return { objectType: "StructureNode", records: rows, total };
}

export function getStructureNodeRecord(
  db: AppDatabase,
  id: string
): RecordRow | null {
  const flat = flattenStructureNodes(readStructure(db).nodes);
  const n = flat.find((x) => x.id === id);
  return n ? nodeToRecord(n) : null;
}

function slugFromId(id: string, parentId: string | null): string {
  if (!parentId) return id;
  const prefix = `${parentId}-`;
  if (id.startsWith(prefix)) return id.slice(prefix.length);
  return id;
}

export function createStructureNodeRecord(
  db: AppDatabase,
  data: RecordData
): RecordRow {
  const parentId =
    data.parent_id === undefined || data.parent_id === null || data.parent_id === ""
      ? null
      : String(data.parent_id);
  const rawId = data.id != null ? String(data.id) : "";
  const slug = parentId ? slugFromId(rawId || String(data.segment ?? ""), parentId) : rawId;
  try {
    const node = createNode(db, {
      id: slug || rawId,
      parentId,
      label: String(data.label ?? ""),
      icon: String(data.icon ?? "folder"),
      segment: data.segment != null ? String(data.segment) : undefined,
      kind: data.kind != null ? String(data.kind) : undefined,
      objectType:
        data.object_type === undefined
          ? undefined
          : data.object_type == null || data.object_type === ""
            ? null
            : String(data.object_type),
      rightSidebar:
        data.right_sidebar === undefined
          ? undefined
          : data.right_sidebar == null || data.right_sidebar === ""
            ? null
            : String(data.right_sidebar),
    });
    return nodeToRecord(node);
  } catch (err) {
    if (err instanceof StructureError) throw err;
    throw err;
  }
}

export function updateStructureNodeRecord(
  db: AppDatabase,
  id: string,
  data: RecordData
): RecordRow {
  const patch: Parameters<typeof updateNode>[2] = {};
  if (data.label != null) patch.label = String(data.label);
  if (data.icon != null) patch.icon = String(data.icon);
  if (data.segment != null) patch.segment = String(data.segment);
  if (data.kind != null) patch.kind = String(data.kind);
  if (data.object_type !== undefined) {
    patch.objectType =
      data.object_type == null || data.object_type === ""
        ? null
        : String(data.object_type);
  }
  if (data.right_sidebar !== undefined) {
    patch.rightSidebar =
      data.right_sidebar == null || data.right_sidebar === ""
        ? null
        : String(data.right_sidebar);
  }
  if (data.parent_id !== undefined) {
    patch.parentId =
      data.parent_id == null || data.parent_id === ""
        ? null
        : String(data.parent_id);
  }
  try {
    updateNode(db, id, patch);
  } catch (err) {
    if (err instanceof StructureError) throw err;
    throw err;
  }
  const row = getStructureNodeRecord(db, id);
  if (!row) throw new StructureError(404, "StructureNode not found after update");
  return row;
}

export function deleteStructureNodeRecord(db: AppDatabase, id: string): void {
  deleteNode(db, id);
}

export const structureNodeAdapter: RecordAdapter = {
  id: "structure_nodes",
  policy: {
    authorize() {
      return true;
    },
  },
  list: (db, _def, query) => {
    const options: {
      parentId?: string | null;
      limit?: number;
      offset?: number;
    } = {
      limit: query.limit,
      offset: query.offset,
    };
    if (query.parentId !== undefined) options.parentId = query.parentId;
    return listStructureNodeRecords(db, options);
  },
  get: (db, _def, id) => getStructureNodeRecord(db, id),
  create: (db, _def, data, ctx) => {
    const row = createStructureNodeRecord(db, data);
    ctx.bus?.emit("structure.node.created", { nodeId: row.id });
    return row;
  },
  update: (db, _def, id, data, ctx) => {
    const row = updateStructureNodeRecord(db, id, data);
    ctx.bus?.emit("structure.node.updated", { nodeId: id });
    return row;
  },
  delete: (db, _def, id, ctx) => {
    deleteStructureNodeRecord(db, id);
    ctx.bus?.emit("structure.node.deleted", { nodeId: id });
  },
  actions: {
    set_agent(db, _def, id, input, ctx) {
      const agentId =
        input.agent_id == null || input.agent_id === ""
          ? null
          : String(input.agent_id);
      setNodeAgent(db, id, agentId);
      ctx.bus?.emit("structure.node.updated", { nodeId: id });
      return getStructureNodeRecord(db, id);
    },
    move(db, _def, id, input, ctx) {
      const row = updateStructureNodeRecord(db, id, {
        parent_id:
          input.parent_id == null || input.parent_id === ""
            ? null
            : String(input.parent_id),
      });
      ctx.bus?.emit("structure.node.updated", { nodeId: id });
      return row;
    },
    reorder(db, _def, _id, input, ctx) {
      const parentId =
        input.parent_id == null || input.parent_id === ""
          ? null
          : String(input.parent_id);
      const orderedIds = Array.isArray(input.ordered_ids)
        ? input.ordered_ids.map(String)
        : [];
      reorderNodes(db, parentId, orderedIds);
      ctx.bus?.emit("structure.reordered", {
        kind: "node",
        parentId,
      });
      return { ok: true };
    },
  },
};
