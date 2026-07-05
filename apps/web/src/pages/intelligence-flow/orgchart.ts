import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";
import type { AiAssignmentRole } from "@/api";

export const ORG_ROOT_AGENT_ID = "intelligence";

export type ScopeType = "department" | "division" | "page";

export interface AgentNodeData {
  kind: "agent";
  agentId: string;
  name: string;
  description: string | null;
  isRoot: boolean;
  team: string | null;
  backend: string;
  ownedCount: number;
  /** Whether this node has hidden/expandable structural children (pre-filter). */
  hasChildren?: boolean;
  /** Whether this node is currently collapsed (its children are hidden). */
  collapsed?: boolean;
  /** Number of direct structural children (for the "+N" affordance). */
  childCount?: number;
  [key: string]: unknown;
}

export interface ScopeNodeData {
  kind: "scope";
  scopeType: ScopeType;
  scopeId: string;
  label: string;
  iconName: string;
  ownerAgentId: string;
  ownerName: string;
  explicit: boolean;
  role: AiAssignmentRole | null;
  builtIn: boolean;
  /** Whether this node has hidden/expandable structural children (pre-filter). */
  hasChildren?: boolean;
  /** Whether this node is currently collapsed (its children are hidden). */
  collapsed?: boolean;
  /** Number of direct structural children (for the "+N" affordance). */
  childCount?: number;
  [key: string]: unknown;
}

/** Single recursive structure page rendered as one org-chart node. */
export interface PageNodeData {
  kind: "page";
  nodeId: string;
  label: string;
  iconName: string;
  /** Explicitly attached agent id (null = inherits). */
  agentId: string | null;
  /** Resolved owner agent name for display. */
  ownerName: string;
  /** Whether an agent is attached directly to this node. */
  explicit: boolean;
  builtIn: boolean;
  /** Whether this node has hidden/expandable structural children (pre-filter). */
  hasChildren?: boolean;
  /** Whether this node is currently collapsed (its children are hidden). */
  collapsed?: boolean;
  /** Number of direct structural children (for the "+N" affordance). */
  childCount?: number;
  [key: string]: unknown;
}

export type OrgNodeData = AgentNodeData | ScopeNodeData | PageNodeData;

export const AGENT_NODE_W = 200;
export const AGENT_NODE_H = 72;
export const SCOPE_NODE_W = 200;
export const SCOPE_NODE_H = 60;

/** Build the React Flow node id for a scope. */
export function scopeNodeId(scopeType: ScopeType, scopeId: string): string {
  return `scope:${scopeType}:${scopeId}`;
}

/** Top-down dagre layout over the structural edges only. */
export function layoutOrgChart(nodes: Node[], edges: Edge[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 36, ranksep: 80, marginx: 20, marginy: 20 });
  for (const n of nodes) {
    const data = n.data as OrgNodeData;
    const isAgent = data.kind === "agent";
    g.setNode(n.id, {
      width: isAgent ? AGENT_NODE_W : SCOPE_NODE_W,
      height: isAgent ? AGENT_NODE_H : SCOPE_NODE_H,
    });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    if (!p) continue;
    out[n.id] = { x: p.x - p.width / 2, y: p.y - p.height / 2 };
  }
  return out;
}
