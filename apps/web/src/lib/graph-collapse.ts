/**
 * Collapse / land defaults for The Graph (architecture projection).
 *
 * Expansion tiers keep every catalog node in the graph. Simple land hides
 * extras; chevrons on You / Hub / Intelligence cycle simple → standard → full
 * → collapsed. Nodes are never removed from the catalog.
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
 * Full Hub → Workspaces → Personal → Structure → Pages path.
 * Workspaces root is on simple land; this path opens at standard/full.
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

/** Representative platform wing root opened at standard/full. */
export const DEFAULT_FULL_DEPTH_WING_ROOT = "hub:workspace";

/** You's Vault (label: User Vault) on default land. */
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

/** You's Structure root. */
export const DEFAULT_YOU_STRUCTURE_ID = "hub:structure-you";

/**
 * Platform-row ids reset when Hub closes: Support / Shared / Marketplace side
 * trees, Marketplace branches, and workspace exemplars.
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
  "hub:workspace",
  "hub:ws-personal",
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

/** Land depth for You / Hub / Intelligence chevrons. */
export type GraphExpansionTier = "simple" | "standard" | "full";

export const GRAPH_EXPANSION_TIERS: readonly GraphExpansionTier[] = [
  "simple",
  "standard",
  "full",
] as const;

export const TIERED_BRANCH_ROOTS = [
  "hub:you",
  "hub:heart",
  "hub:intelligence",
] as const;

export type TieredBranchRoot = (typeof TIERED_BRANCH_ROOTS)[number];

export function isTieredBranchRoot(id: string): id is TieredBranchRoot {
  return (TIERED_BRANCH_ROOTS as readonly string[]).includes(id);
}

export function defaultBranchTiers(): Record<TieredBranchRoot, GraphExpansionTier> {
  return {
    "hub:you": "simple",
    "hub:heart": "simple",
    "hub:intelligence": "simple",
  };
}

/** You simple: Calendar, Tasks (via Calendar), Settings, Knowledge, Profile, Structure, Vault + Hub. */
export const YOU_SIMPLE_CHILD_IDS = [
  "hub:heart",
  "hub:calendar-you",
  "hub:settings",
  "hub:knowledge-you",
  "hub:users",
  "hub:structure-you",
  "hub:vault-you",
] as const;

/** You standard adds Admin, Agents index, Automations. */
export const YOU_STANDARD_CHILD_IDS = [
  ...YOU_SIMPLE_CHILD_IDS,
  "hub:admin",
  "hub:agents",
  "hub:automations-you",
] as const;

/** Hub simple: Support, Shared, Marketplace, Workspaces, Wiki, Platform Vault (+ agent spine). */
export const HUB_SIMPLE_CHILD_IDS = [
  "hub:support",
  "hub:shared",
  "hub:marketplace",
  "hub:workspace",
  "hub:wiki",
  "hub:vault-platform",
  "hub:agent-research",
  "hub:agent-ops",
] as const;

/** Hub standard adds Coding and Releases (Workspaces already on simple). */
export const HUB_STANDARD_CHILD_IDS = [
  ...HUB_SIMPLE_CHILD_IDS,
  "hub:coding",
  "hub:releases",
] as const;

/** Intelligence simple: Hub link, Vault, Structure, Knowledge, Calendar (Tasks via Calendar). */
export const INTEL_SIMPLE_CHILD_IDS = [
  "hub:heart",
  "hub:vault-intelligence",
  "hub:structure-intelligence",
  "hub:knowledge-intelligence",
  "hub:calendar-intelligence",
] as const;

export const INTEL_STANDARD_CHILD_IDS = [
  ...INTEL_SIMPLE_CHILD_IDS,
  "hub:automations-intelligence",
] as const;

const YOU_CHILDREN_BY_TIER: Record<
  GraphExpansionTier,
  ReadonlySet<string> | null
> = {
  simple: new Set(YOU_SIMPLE_CHILD_IDS),
  standard: new Set(YOU_STANDARD_CHILD_IDS),
  full: null,
};

const HUB_CHILDREN_BY_TIER: Record<
  GraphExpansionTier,
  ReadonlySet<string> | null
> = {
  simple: new Set(HUB_SIMPLE_CHILD_IDS),
  standard: new Set(HUB_STANDARD_CHILD_IDS),
  full: null,
};

const INTEL_CHILDREN_BY_TIER: Record<
  GraphExpansionTier,
  ReadonlySet<string> | null
> = {
  simple: new Set(INTEL_SIMPLE_CHILD_IDS),
  standard: new Set(INTEL_STANDARD_CHILD_IDS),
  full: null,
};

function allowedChildrenForTier(
  rootId: string,
  tier: GraphExpansionTier
): ReadonlySet<string> | null {
  if (rootId === "hub:you") return YOU_CHILDREN_BY_TIER[tier];
  if (rootId === "hub:heart") return HUB_CHILDREN_BY_TIER[tier];
  if (rootId === "hub:intelligence") return INTEL_CHILDREN_BY_TIER[tier];
  return null;
}

/**
 * Nested nodes hidden while a branch is on simple (self hidden; catalog kept).
 * Tasks stay visible under Calendar; Events stay tucked away.
 */
export const SIMPLE_NESTED_HIDE_BY_ROOT: Record<
  TieredBranchRoot,
  readonly string[]
> = {
  "hub:you": [
    "hub:bank-you",
    "hub:wallet-you",
    "hub:events-you",
    "hub:departments-you",
    "hub:divisions-you",
    "hub:pages-you",
    "hub:memories-you",
    "hub:rules-you",
    "hub:skills-you",
    "hub:artifacts-you",
    "hub:tools-you",
  ],
  "hub:intelligence": [
    "hub:bank-intelligence",
    "hub:wallet-intelligence",
    "hub:events-intelligence",
    "hub:departments-intelligence",
    "hub:divisions-intelligence",
    "hub:pages-intelligence",
    "hub:memories-intelligence",
    "hub:rules-intelligence",
    "hub:skills-intelligence",
    "hub:artifacts-intelligence",
    "hub:tools-intelligence",
  ],
  "hub:heart": [],
};

/** Flat list for tests / docs. */
export const SIMPLE_NESTED_HIDE_IDS = [
  ...SIMPLE_NESTED_HIDE_BY_ROOT["hub:you"],
  ...SIMPLE_NESTED_HIDE_BY_ROOT["hub:intelligence"],
] as const;

/**
 * Default land (simple tier):
 * - You: Calendar (+ Tasks), Settings, Knowledge, Profile, Structure, Vault, Hub
 * - Hub: Support, Shared, Marketplace, Workspaces, Wiki, Platform Vault
 *   (side trees / workspace children closed)
 * - Intelligence expanded to its simple surfaces; Research / Ops collapsed
 * - Deeper nests stay collapsed until standard/full
 */
export const DEFAULT_COLLAPSED_IDS = [
  // You: show surface roots but keep one level closed (Calendar stays open for Tasks)
  "hub:structure-you",
  "hub:knowledge-you",
  "hub:automations-you",
  // Intelligence: same pattern; Automations tucked until standard
  "hub:structure-intelligence",
  "hub:knowledge-intelligence",
  "hub:automations-intelligence",
  // Other agents collapsed (children hidden); difference helper may re-open diffs
  "hub:agent-research",
  "hub:agent-ops",
  ...ownerSurfaceRootIds("research"),
  ...ownerSurfaceRootIds("ops"),
  "hub:vault-research",
  "hub:vault-ops",
  // Platform side trees + Workspaces children (Workspaces root is visible on simple)
  ...PLATFORM_RAY_COLLAPSED_IDS,
  "hub:coding",
  "hub:releases",
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

function hideSubtree(
  children: Map<string, string[]>,
  hidden: Set<string>,
  rootId: string
): void {
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (hidden.has(id)) continue;
    hidden.add(id);
    for (const child of collapseChildrenOf(children, id)) {
      stack.push(child);
    }
  }
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
 * Full visibility filter: classic collapse plus expansion-tier child gates.
 * Catalog nodes stay registered; tiers only hide.
 */
export function hiddenGraphNodeIds(
  edges: readonly CollapseEdge[],
  collapsed: Set<string>,
  branchTiers: Readonly<Partial<Record<string, GraphExpansionTier>>> = defaultBranchTiers()
): Set<string> {
  const children = buildCollapseChildMap(edges);
  const hidden = hiddenDescendantIds(edges, collapsed);

  for (const rootId of TIERED_BRANCH_ROOTS) {
    if (collapsed.has(rootId)) continue;
    const tier = branchTiers[rootId] ?? "simple";
    const allowed = allowedChildrenForTier(rootId, tier);
    if (!allowed) continue;
    for (const child of children.get(rootId) ?? []) {
      if (allowed.has(child)) continue;
      hideSubtree(children, hidden, child);
    }
  }

  for (const rootId of TIERED_BRANCH_ROOTS) {
    if (collapsed.has(rootId)) continue;
    if ((branchTiers[rootId] ?? "simple") !== "simple") continue;
    for (const id of SIMPLE_NESTED_HIDE_BY_ROOT[rootId]) {
      if (!hidden.has(id)) hideSubtree(children, hidden, id);
    }
  }

  // Agents with unique branches: keep the agent open, hide Intelligence twins.
  for (const agentId of children.keys()) {
    if (!agentId.startsWith("hub:agent-")) continue;
    if (collapsed.has(agentId)) continue;
    const diffs = new Set(agentDifferenceChildIds(edges, agentId));
    if (diffs.size === 0) continue;
    for (const child of children.get(agentId) ?? []) {
      if (diffs.has(child)) continue;
      hideSubtree(children, hidden, child);
    }
  }

  return hidden;
}

/**
 * Cycle You / Hub / Intelligence: collapsed → simple → standard → full → collapsed.
 * Returns whether the handler consumed the toggle (tiered root).
 */
export function cycleTieredBranch(
  nodeId: string,
  collapsed: Set<string>,
  branchTiers: Record<string, GraphExpansionTier>
): boolean {
  if (!isTieredBranchRoot(nodeId)) return false;

  if (collapsed.has(nodeId)) {
    collapsed.delete(nodeId);
    branchTiers[nodeId] = "simple";
    return true;
  }

  const tier = branchTiers[nodeId] ?? "simple";
  if (tier === "simple") {
    branchTiers[nodeId] = "standard";
    return true;
  }
  if (tier === "standard") {
    branchTiers[nodeId] = "full";
    // Open nested roots that simple/standard kept closed.
    if (nodeId === "hub:you") {
      collapsed.delete("hub:structure-you");
      collapsed.delete("hub:knowledge-you");
      collapsed.delete("hub:automations-you");
      collapsed.delete("hub:calendar-you");
      collapsed.delete(DEFAULT_YOU_VAULT_ID);
    }
    if (nodeId === "hub:intelligence") {
      collapsed.delete("hub:structure-intelligence");
      collapsed.delete("hub:knowledge-intelligence");
      collapsed.delete("hub:automations-intelligence");
      collapsed.delete("hub:calendar-intelligence");
      collapsed.delete("hub:vault-intelligence");
    }
    if (nodeId === "hub:heart") {
      for (const id of PLATFORM_RAY_COLLAPSED_IDS) collapsed.delete(id);
      collapsed.delete("hub:coding");
      collapsed.delete("hub:releases");
    }
    return true;
  }

  collapsed.add(nodeId);
  branchTiers[nodeId] = "simple";
  if (nodeId === "hub:heart") {
    recollapsePlatformRayBeyond(collapsed, nodeId);
  }
  return true;
}

/**
 * Template child id suffixes under Intelligence. Agents whose direct children
 * include ids outside this set expand those differing branches on land.
 */
export const INTELLIGENCE_TEMPLATE_CHILD_IDS = new Set([
  ...INTEL_SIMPLE_CHILD_IDS,
  ...INTEL_STANDARD_CHILD_IDS,
  "hub:automations-intelligence",
]);

/**
 * For agent hubs other than Intelligence, return child ids that are not in the
 * Intelligence template so land can expand only the differences.
 */
export function agentDifferenceChildIds(
  edges: readonly CollapseEdge[],
  agentId: string
): string[] {
  if (agentId === "hub:intelligence") return [];
  const children = buildCollapseChildMap(edges);
  const kids = children.get(agentId) ?? [];
  const intelKids = new Set(children.get("hub:intelligence") ?? []);
  // Compare by kind suffix after the last hyphen group when mirrored
  // (structure-X vs structure-intelligence). Prefer exact-template mismatch.
  const diffs: string[] = [];
  for (const child of kids) {
    const suffix = child.replace(/^hub:/, "").replace(/-[^-]+$/, "");
    const intelTwin = [...intelKids].find((id) =>
      id.replace(/^hub:/, "").replace(/-[^-]+$/, "") === suffix
    );
    if (!intelTwin) diffs.push(child);
  }
  return diffs;
}

/**
 * Seed collapsed set so agents that only mirror Intelligence stay collapsed,
 * while agents with extra branches open so differences can be shown.
 */
export function applyAgentDifferenceExpansions(
  edges: readonly CollapseEdge[],
  collapsed: Set<string>,
  agentIds: readonly string[]
): void {
  for (const agentId of agentIds) {
    if (agentId === "hub:intelligence") continue;
    const diffs = agentDifferenceChildIds(edges, agentId);
    if (diffs.length === 0) collapsed.add(agentId);
    else collapsed.delete(agentId);
  }
}

/**
 * When collapsing Hub, reset platform-row branch expands so the next Hub
 * open starts with side trees closed. Fan peer chevrons do not cascade.
 */
export function recollapsePlatformRayBeyond(
  next: Set<string>,
  collapsedNodeId: string
): void {
  if (collapsedNodeId === "hub:heart") {
    for (const id of PLATFORM_RAY_COLLAPSED_IDS) next.add(id);
    next.add("hub:coding");
    next.add("hub:releases");
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
