import type { CompileResult, GraphCompiler } from "./types.js";

/** Layout sidecar persisted alongside structure_nodes (positions, collapse, viewport). */
export interface StructureGraphLayout {
  version: number;
  viewport?: { x: number; y: number; zoom: number };
  positions: Record<string, { x: number; y: number }>;
  collapsed: string[];
}

/** Runtime spec: the structure_nodes tree (navigation + ownership). */
export interface StructureSpecNode {
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
  children: StructureSpecNode[];
}

export interface StructureSpec {
  nodes: StructureSpecNode[];
}

export interface StructureGraphDoc {
  layout: StructureGraphLayout;
  /** Mirrors structure_nodes — the graph view is canonical for edits. */
  tree: StructureSpec;
}

export const STRUCTURE_GRAPH_DOMAIN_ID = "structure";

export const structureGraphCompiler: GraphCompiler<StructureGraphDoc, StructureSpec> = {
  compile(graph: StructureGraphDoc): CompileResult<StructureSpec> {
    return { spec: graph.tree, diagnostics: [] };
  },
  project(spec: StructureSpec): StructureGraphDoc {
    return {
      layout: {
        version: 1,
        positions: {},
        collapsed: [],
      },
      tree: spec,
    };
  },
};
