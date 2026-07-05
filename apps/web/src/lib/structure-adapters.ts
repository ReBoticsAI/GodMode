import type { DepartmentNode, DivisionNode, PageNode, StructureNode } from "./navigation";

/** Flatten a recursive page tree for path lookups. */
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

function pageIdFromNode(node: StructureNode, parent: StructureNode): string {
  const prefix = `${parent.id}-`;
  if (node.id.startsWith(prefix)) return node.id.slice(prefix.length);
  return node.segment || node.id;
}

/**
 * Bridge adapter: recursive pages -> legacy department/division/pages shape so
 * routing and sidebar keep working during the transition.
 */
export function nodesToLegacyDepartments(nodes: StructureNode[]): DepartmentNode[] {
  return nodes.map((top) => ({
    id: top.id,
    label: top.label,
    icon: top.icon,
    basePath: top.path,
    builtIn: top.builtIn,
    sortOrder: top.sortOrder,
    divisions: top.children.map((div) => divisionFromNode(div, top)),
  }));
}

function divisionFromNode(node: StructureNode, dept: StructureNode): DivisionNode {
  const indexPage: PageNode = {
    id: "index",
    label: node.label,
    icon: node.icon,
    segment: "",
    kind: node.kind,
    builtIn: node.builtIn,
    sortOrder: 0,
  };
  const subPages: PageNode[] = node.children.map((child, idx) => ({
    id: pageIdFromNode(child, node),
    label: child.label,
    icon: child.icon,
    segment: child.segment,
    kind: child.kind,
    builtIn: child.builtIn,
    sortOrder: child.sortOrder ?? idx + 1,
  }));

  return {
    id: node.segment,
    departmentId: dept.id,
    label: node.label,
    icon: node.icon,
    basePath: node.path,
    rightSidebar: node.rightSidebar,
    builtIn: node.builtIn,
    sortOrder: node.sortOrder,
    pages: [indexPage, ...subPages],
  };
}

export function nodeFromPath(
  pathname: string,
  nodes: StructureNode[]
): StructureNode | undefined {
  const flat = flattenStructureNodes(nodes);
  const path =
    !pathname || pathname === "/"
      ? "/"
      : pathname.endsWith("/") && pathname.length > 1
        ? pathname.slice(0, -1)
        : pathname;
  const sorted = [...flat].sort((a, b) => b.path.length - a.path.length);
  for (const n of sorted) {
    const base = n.path.replace(/\/$/, "") || "/";
    if (path === base || (base !== "/" && path.startsWith(`${base}/`))) return n;
  }
  return flat[0];
}

export function resolveRightSidebar(
  node: StructureNode | undefined,
  allNodes: StructureNode[]
): string | null {
  if (!node) return null;
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  let current: StructureNode | undefined = node;
  while (current) {
    if (current.rightSidebar) return current.rightSidebar;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

export function firstNavigableChild(node: StructureNode): string {
  if (node.children.length === 0) return node.path;
  return firstNavigableChild(node.children[0]);
}
