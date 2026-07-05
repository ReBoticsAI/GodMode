import type { DepartmentNode, StructureNode } from "./navigation";
import { divisionFromPath } from "./navigation";
import { flattenStructureNodes } from "./structure-adapters";

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname;
}

/**
 * Returns the explicitly attached agent id for a route, if any.
 * Does not walk ancestors — only nodes with agentId set directly qualify.
 */
export function agentIdForPagePath(
  pathname: string,
  nodes: StructureNode[]
): string | null {
  const path = normalizePath(pathname);
  for (const node of flattenStructureNodes(nodes)) {
    if (normalizePath(node.path) === path && node.agentId) {
      return node.agentId;
    }
  }
  return null;
}

/**
 * Page agents that should auto-bind the Intelligence chat target on navigation.
 * Only divisions whose structure node sets `rightSidebar: "price"` auto-open chat;
 * other plugin divisions keep Intelligence as the default unless the user picks
 * another agent explicitly.
 */
export function autoChatAgentIdForPagePath(
  pathname: string,
  nodes: StructureNode[],
  departments: DepartmentNode[]
): string | null {
  const agentId = agentIdForPagePath(pathname, nodes);
  if (!agentId) return null;
  const division = divisionFromPath(pathname, departments);
  if (division?.rightSidebar === "price") return agentId;
  return null;
}

/** Deterministic tenant-scoped user persona agent id. */
export function userAgentIdForUser(userId: string): string {
  return `user-${userId}`;
}

export function isUserAgentId(agentId: string): boolean {
  return agentId.startsWith("user-");
}
