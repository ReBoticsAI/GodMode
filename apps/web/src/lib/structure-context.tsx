import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, connectWebSocket } from "../api";
import { loadWebPlugins } from "@/plugins/loader";
import type { GroupTabDef } from "./group-tab-definitions";
import type { DepartmentNode, DivisionNode, PageNode, StructureNode } from "./navigation";
import { nodesToLegacyDepartments } from "./structure-adapters";

interface StructureRecord {
  id: string;
  data: Record<string, unknown>;
}

interface StructureRecordsResponse {
  records: StructureRecord[];
}

function adaptRecords(apiRes: StructureRecordsResponse): {
  nodes: StructureNode[];
  departments: DepartmentNode[];
} {
  const byId = new Map<string, StructureNode>();
  for (const row of apiRes.records) {
    const data = row.data;
    byId.set(row.id, {
      id: row.id,
      parentId: (data.parent_id as string | null) ?? null,
      label: String(data.label ?? ""),
      icon: String(data.icon ?? "folder"),
      segment: String(data.segment ?? ""),
      path: String(data.path ?? ""),
      kind: String(data.kind ?? "placeholder"),
      objectType: (data.object_type as string | null) ?? null,
      rightSidebar: (data.right_sidebar as string | null) ?? null,
      agentId: (data.agent_id as string | null) ?? null,
      builtIn: Boolean(data.built_in),
      sortOrder: Number(data.sort_order ?? 0),
      tabs: (data.tabs_json as GroupTabDef[] | null) ?? null,
      children: [],
    });
  }
  const roots: StructureNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: StructureNode[]) => {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return { nodes: roots, departments: nodesToLegacyDepartments(roots) };
}

interface StructureCtxValue {
  nodes: StructureNode[];
  departments: DepartmentNode[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const StructureCtx = createContext<StructureCtxValue>({
  nodes: [],
  departments: [],
  loading: true,
  error: null,
  reload: async () => {},
});

export function StructureProvider({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<StructureNode[]>([]);
  const [departments, setDepartments] = useState<DepartmentNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Ignore stale /records responses when overlapping structure_changed reloads race. */
  const reloadGen = useRef(0);

  const reload = useCallback(async () => {
    const gen = ++reloadGen.current;
    try {
      const res = await api<StructureRecordsResponse>(
        "/records/StructureNode?limit=500"
      );
      if (gen !== reloadGen.current) return;
      const adapted = adaptRecords(res);
      setNodes(adapted.nodes);
      setDepartments(adapted.departments);
      setError(null);
    } catch (err) {
      if (gen !== reloadGen.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === reloadGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return connectWebSocket((raw) => {
      const msg = raw as { type?: string };
      if (msg?.type === "structure_changed") {
        void reload();
        // Install/rebuild often seeds Structure; refresh web bundles so page
        // kinds match without requiring a full browser reload.
        void loadWebPlugins();
      }
    });
  }, [reload]);

  const value = useMemo(
    () => ({ nodes, departments, loading, error, reload }),
    [nodes, departments, loading, error, reload]
  );

  return (
    <StructureCtx.Provider value={value}>{children}</StructureCtx.Provider>
  );
}

export function useStructure(): StructureCtxValue {
  return useContext(StructureCtx);
}

export type { DivisionNode, PageNode };
