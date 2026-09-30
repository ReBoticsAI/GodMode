/**
 * Collapse / land defaults for The Graph (architecture projection).
 *
 * Platform fan (Support, Shared, Marketplace, Workspaces, Wiki) are independent
 * Hub children via `platform` edges. Hub's land cutoff hides the whole fan.
 * Chevrons on Support / Shared / Marketplace toggle side branches only.
 */

/** Main-line hubs past Hub (visible together when Hub is expanded). */
export const PLATFORM_SPINE_IDS = [
  "hub:support",
  "hub:shared",
  "hub:marketplace",
  "hub:workspace",
] as const;

export const PLATFORM_SPINE_ID_SET = new Set<string>(PLATFORM_SPINE_IDS);

/**
 * Default full-depth platform wing (labels in comments):
 * Hub → Workspaces → Personal → Structure → Pages
 * (Support / Shared / Marketplace are sibling Hub children, also visible.)
 */
export const DEFAULT_HUB_TO_PAGE_PATH = [
  "hub:heart",
  "hub:support",
  "hub:shared",
  "hub:marketplace",
  "hub:workspace",
  "hub:ws-personal",
  "hub:structure-personal",
  "hub:pages-personal",
] as const;

/** Representative platform wing root opened to full depth by default. */
export const DEFAULT_FULL_DEPTH_WING_ROOT = "hub:workspace";

/** You's Vault (label: User Vault) expanded on default land. */
export const DEFAULT_YOU_VAULT_ID = "hub:vault-you";

/** Owner surface roots that fan directly off You / an agent. */
export const OWNER_SURFACE_KINDS = [
  "structure",
  "knowledge",
  "automations",
  "calendar",
] as const;

export const OWNER_SURFACE_SIDES = [
  "you",
  "intelligence",
  "research",
  "ops",
] as const;

export function ownerSurfaceRootIds(
  side: (typeof OWNER_SURFACE_SIDES)[number]
): string[] {
  return OWNER_SURFACE_KINDS.map((kind) => `hub:${kind}-${side}`);
}

/** You's Structure root (representative of You's open surface wing). */
export const DEFAULT_YOU_STRUCTURE_ID = "hub:structure-you";

/**
 * Platform-row ids reset when Hub closes: Support / Shared / Marketplace side
 * trees, Marketplace branches, and sibling workspaces. Keeps Workspaces +
 * Personal open so the Hub→Page path restores when Hub expands again.
 */
export const PLATFORM_RAY_COLLAPSED_IDS = [
  "hub:support",
  "hub:shared",
  "hub:marketplace",
  "hub:marketplace-community",
  "hub:marketplace-local",
  "hub:marketplace-installed",
  "hub:marketplace-sell",
  "hub:marketplace-official",
  "hub:ws-project-alpha",
  "hub:ws-family",
] as const;

/**
 * Hub also parents Research / Ops on the agent spine. Collapse must not hide
 * those when Hub is the platform-row cutoff.
 */
export const HUB_SPINE_KEEP_VISIBLE = new Set([
  "hub:agent-research",
  "hub:agent-ops",
]);

/**
 * Edge kinds skipped when building collapse children. Legacy `platform-chain`
 * peers (if any remain) must not nest under each other.
 */
export const COLLAPSE_SKIP_EDGE_KINDS = new Set(["platform-chain"]);

/**
 * Default land:
 * - Hub expanded: full platform fan visible; one Workspace→Page depth reveal
 *   (Personal → Structure → Pages). Sibling workspaces stay collapsed.
 * - You Vault expanded (Vault → Bank → Wallet). You owner surfaces expanded
 *   (Structure / Knowledge / Automations / Calendar under You). Other Vault /
 *   agent surface wings (Intelligence / Research / Ops) closed.
 * - Support / Shared / Marketplace side trees closed until their chevrons open.
 */
export const DEFAULT_COLLAPSED_IDS = [
  ...ownerSurfaceRootIds("intelligence"),
  ...ownerSurfaceRootIds("research"),
  ...ownerSurfaceRootIds("ops"),
  "hub:vault-intelligence",
  "hub:vault-research",
  "hub:vault-ops",
  ...PLATFORM_RAY_COLLAPSED_IDS,
] as const;

export type CollapseEdge = {
  source: string;
  target: string;
  kind?: string;
};

export function defaultCollapsedSet(): Set<string> {
  return new Set(DEFAULT_COLLAPSED_IDS);
}

/** Outgoing collapse children (skips spine-chain edges; keeps Research/Ops). */
export function collapseChildrenOf(
  children: Map<string, string[]>,
  id: string
): string[] {
  const raw = children.get(id) ?? [];
  if (id !== "hub:heart") return raw;
  return raw.filter((child) => !HUB_SPINE_KEEP_VISIBLE.has(child));
}

function buildCollapseChildMap(
  edges: readonly CollapseEdge[]
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind && COLLAPSE_SKIP_EDGE_KINDS.has(e.kind)) continue;
    const list = children.get(e.source);
    if (list) list.push(e.target);
    else children.set(e.source, [e.target]);
  }
  return children;
}

/**
 * Descendants of collapsed roots (outgoing collapse BFS). Roots stay visible.
 * Collapsing Hub also hides the entire platform fan (not only Support).
 */
export function hiddenDescendantIds(
  edges: readonly CollapseEdge[],
  collapsed: Set<string>
): Set<string> {
  const children = buildCollapseChildMap(edges);
  const hidden = new Set<string>();
  const stack = [...collapsed];

  if (collapsed.has("hub:heart")) {
    for (const id of PLATFORM_SPINE_IDS) {
      if (hidden.has(id)) continue;
      hidden.add(id);
      stack.push(id);
    }
  }

  while (stack.length) {
    const id = stack.pop()!;
    for (const child of collapseChildrenOf(children, id)) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      stack.push(child);
    }
  }

  return hidden;
}

/**
 * When collapsing Hub, reset platform-row branch expands so the next Hub
 * open starts with side trees closed. Fan peer chevrons do not cascade.
 * Workspaces + Personal stay out of this reset so the Page path returns.
 */
export function recollapsePlatformRayBeyond(
  next: Set<string>,
  collapsedNodeId: string
): void {
  if (collapsedNodeId === "hub:heart") {
    for (const id of PLATFORM_RAY_COLLAPSED_IDS) next.add(id);
    return;
  }
  if (collapsedNodeId === "hub:marketplace") {
    for (const id of PLATFORM_RAY_COLLAPSED_IDS) {
      if (id.startsWith("hub:marketplace-")) next.add(id);
    }
    return;
  }
  if (collapsedNodeId === "hub:workspace") {
    next.add("hub:ws-personal");
    next.add("hub:ws-project-alpha");
    next.add("hub:ws-family");
  }
}
