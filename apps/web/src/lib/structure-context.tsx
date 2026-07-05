import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, connectWebSocket } from "../api";
import type { GroupTabDef } from "./group-tab-definitions";
import type { DepartmentNode, DivisionNode, PageNode, StructureNode } from "./navigation";
import { nodesToLegacyDepartments } from "./structure-adapters";

interface StructureApiNode {
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
  tabs: GroupTabDef[] | null;
  children: StructureApiNode[];
}

interface StructureApiResponse {
  nodes: StructureApiNode[];
}

function adaptNodes(apiRes: StructureApiResponse): {
  nodes: StructureNode[];
  departments: DepartmentNode[];
} {
  const nodes: StructureNode[] = apiRes.nodes.map(mapNode);
  return { nodes, departments: nodesToLegacyDepartments(nodes) };
}

function mapNode(n: StructureApiNode): StructureNode {
  return {
    id: n.id,
    parentId: n.parentId,
    label: n.label,
    icon: n.icon,
    segment: n.segment,
    path: n.path,
    kind: n.kind,
    rightSidebar: n.rightSidebar,
    agentId: n.agentId,
    builtIn: n.builtIn,
    sortOrder: n.sortOrder,
    tabs: n.tabs ?? null,
    children: n.children.map(mapNode),
  };
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

  const reload = useCallback(async () => {
    try {
      const res = await api<StructureApiResponse>("/structure");
      const adapted = adaptNodes(res);
      setNodes(adapted.nodes);
      setDepartments(adapted.departments);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return connectWebSocket((raw) => {
      const msg = raw as { type?: string };
      if (msg?.type === "structure_changed") void reload();
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
