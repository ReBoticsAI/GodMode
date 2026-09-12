/**
 * Graph node visual constraints:
 * 1. Icon is resolved from objectType / role first, then kind. Two hubs must
 *    not share a silhouette just because both are kind "system".
 * 2. Colors belong to a role family (Person = green, Agent = purple,
 *    Chat = bright yellow, Life / Vault / Hub each have their own family).
 *    Each instance is a shade of that family.
 * 3. Child shades are derivatives of their parent.
 */

export const GRAPH_NODE_KINDS = [
  "chat",
  "agent",
  "user",
  "memory",
  "skill",
  "tool",
  "workflow",
  "schedule",
  "page",
  "unlock",
  "system",
] as const;

export type GraphNodeKindId = (typeof GRAPH_NODE_KINDS)[number];

/**
 * Distinct SVG silhouette keys. CONSTRAINT: every key has a unique icon in
 * GraphNodeGlyph. Prefer objectType/role keys over bare kind for hubs.
 */
export const GRAPH_GLYPH_KEYS = [
  "chat",
  "agent",
  "agents",
  "user",
  "memory",
  "skill",
  "tool",
  "artifact",
  "workflow",
  "schedule",
  "page",
  "unlock",
  "system",
  "life",
  "vault",
  "heart",
  "support",
  "shared",
  "marketplace",
  "workspace",
  "bank",
  "structure",
  "departments",
  "divisions",
  "wiki",
  "rule",
  "hook",
  "task",
  "knowledge",
  "automations",
  "calendar",
  "pack",
  "connector",
  "tickets",
  "network",
  "grants",
] as const;

export type GraphGlyphKey = (typeof GRAPH_GLYPH_KEYS)[number];

export type KindColorFamily = {
  h: number;
  s: number;
  lMin: number;
  lMax: number;
  canonical: string;
};

/** Kind fallbacks when no objectType family applies. */
export const KIND_COLOR_FAMILY: Record<GraphNodeKindId, KindColorFamily> = {
  chat: { h: 52, s: 98, lMin: 52, lMax: 62, canonical: "#facc15" },
  agent: { h: 270, s: 78, lMin: 55, lMax: 72, canonical: "#a78bfa" },
  user: { h: 152, s: 70, lMin: 42, lMax: 62, canonical: "#34d399" },
  memory: { h: 32, s: 92, lMin: 48, lMax: 62, canonical: "#fb923c" },
  skill: { h: 340, s: 82, lMin: 52, lMax: 68, canonical: "#fb7185" },
  tool: { h: 215, s: 28, lMin: 48, lMax: 64, canonical: "#94a3b8" },
  workflow: { h: 310, s: 78, lMin: 55, lMax: 70, canonical: "#e879f9" },
  schedule: { h: 172, s: 72, lMin: 42, lMax: 58, canonical: "#2dd4bf" },
  page: { h: 210, s: 88, lMin: 52, lMax: 68, canonical: "#60a5fa" },
  unlock: { h: 42, s: 90, lMin: 42, lMax: 55, canonical: "#eab308" },
  system: { h: 30, s: 12, lMin: 48, lMax: 64, canonical: "#a8a29e" },
};

/** Role / objectType color families (hubs must not all share "system" gray). */
export const ROLE_COLOR_FAMILY: Record<string, KindColorFamily> = {
  LifeSurface: { h: 140, s: 72, lMin: 40, lMax: 58, canonical: "#4ade80" },
  VaultSecret: { h: 45, s: 88, lMin: 42, lMax: 58, canonical: "#f59e0b" },
  BridgeConnection: { h: 350, s: 78, lMin: 48, lMax: 64, canonical: "#f43f5e" },
  Support: { h: 190, s: 78, lMin: 45, lMax: 62, canonical: "#22d3ee" },
  SharedSurface: { h: 250, s: 70, lMin: 52, lMax: 68, canonical: "#818cf8" },
  Marketplace: { h: 285, s: 72, lMin: 52, lMax: 68, canonical: "#c084fc" },
  Workspace: { h: 200, s: 55, lMin: 45, lMax: 62, canonical: "#38bdf8" },
  Artifact: { h: 25, s: 78, lMin: 48, lMax: 64, canonical: "#fb923c" },
  ToolDefinition: { h: 215, s: 35, lMin: 48, lMax: 64, canonical: "#94a3b8" },
  StructureNode: { h: 205, s: 70, lMin: 48, lMax: 65, canonical: "#38bdf8" },
  WikiPage: { h: 222, s: 75, lMin: 48, lMax: 65, canonical: "#60a5fa" },
  AgentRule: { h: 15, s: 70, lMin: 48, lMax: 62, canonical: "#f97316" },
  AgentSkill: { h: 340, s: 82, lMin: 52, lMax: 68, canonical: "#fb7185" },
  Hook: { h: 300, s: 55, lMin: 50, lMax: 66, canonical: "#d946ef" },
  Task: { h: 160, s: 65, lMin: 42, lMax: 58, canonical: "#34d399" },
  FinanceConnection: { h: 85, s: 70, lMin: 42, lMax: 58, canonical: "#a3e635" },
  Memory: { h: 32, s: 92, lMin: 48, lMax: 62, canonical: "#fb923c" },
  Workflow: { h: 310, s: 78, lMin: 55, lMax: 70, canonical: "#e879f9" },
  Schedule: { h: 172, s: 72, lMin: 42, lMax: 58, canonical: "#2dd4bf" },
  CalendarEvent: { h: 172, s: 68, lMin: 42, lMax: 58, canonical: "#14b8a6" },
  User: { h: 152, s: 70, lMin: 42, lMax: 62, canonical: "#34d399" },
  Agent: { h: 270, s: 78, lMin: 55, lMax: 72, canonical: "#a78bfa" },
  ChatSession: { h: 52, s: 98, lMin: 52, lMax: 62, canonical: "#facc15" },
};

const DEFAULT_FAMILY: KindColorFamily = {
  h: 220,
  s: 20,
  lMin: 48,
  lMax: 64,
  canonical: "#94a3b8",
};

export function isGraphNodeKind(kind: string): kind is GraphNodeKindId {
  return (GRAPH_NODE_KINDS as readonly string[]).includes(kind);
}

export function isGraphGlyphKey(key: string): key is GraphGlyphKey {
  return (GRAPH_GLYPH_KEYS as readonly string[]).includes(key);
}

export type GraphGlyphInput = {
  kind: string;
  objectType?: string | null;
  id?: string;
  label?: string;
};

/**
 * Pick a unique silhouette for this node. objectType / label / id win over
 * bare kind so Life, Vault, Hub, Support are not all the system hex.
 */
export function resolveGraphGlyphKey(input: GraphGlyphInput): GraphGlyphKey {
  const ot = (input.objectType ?? "").trim();
  const label = (input.label ?? "").trim().toLowerCase();
  const id = (input.id ?? "").toLowerCase();

  const byObjectType: Record<string, GraphGlyphKey> = {
    LifeSurface: "life",
    VaultSecret: "vault",
    BridgeConnection: "heart",
    Support: "support",
    SharedSurface: "shared",
    Marketplace: "marketplace",
    Workspace: "workspace",
    Artifact: "artifact",
    ToolDefinition: "tool",
    WikiPage: "wiki",
    AgentRule: "rule",
    AgentSkill: "skill",
    Hook: "hook",
    Task: "task",
    FinanceConnection: "bank",
    Memory: "memory",
    Workflow: "workflow",
    Schedule: "schedule",
    CalendarEvent: "calendar",
    User: "user",
    Agent: "agent",
    ChatSession: "chat",
  };

  // Agents hub (group) vs a single Agent instance (Intelligence, Research, …).
  if (
    label === "agents" ||
    id.includes(":agents-") ||
    id.endsWith(":agents") ||
    id === "hub:agents"
  ) {
    return "agents";
  }

  if (ot === "StructureNode") {
    if (label.includes("department") || id.includes("department")) {
      return "departments";
    }
    if (label.includes("division") || id.includes("division")) {
      return "divisions";
    }
    if (label === "pages" || id.includes(":pages") || id.endsWith("-pages")) {
      return "page";
    }
    return "structure";
  }

  if (ot && byObjectType[ot]) return byObjectType[ot];

  // Marketplace / support children often share objectType; refine by label.
  if (ot === "Marketplace" || ot === "Support" || ot === "SharedSurface") {
    if (label.includes("pack")) return "pack";
    if (label.includes("connector")) return "connector";
    if (label.includes("ticket")) return "tickets";
    if (label.includes("network")) return "network";
    if (label.includes("grant")) return "grants";
    if (label.includes("official") || label.includes("community") || label.includes("local") || label.includes("install") || label.includes("sell")) {
      return "marketplace";
    }
  }

  if (label === "life" || id.includes(":life") || id.includes("life-")) return "life";
  if (label.includes("vault") || id.includes("vault")) return "vault";
  if (label === "heart" || id.includes("heart")) return "heart";
  if (label === "support" || id === "hub:support") return "support";
  if (label === "shared" || id === "hub:shared") return "shared";
  if (label.includes("marketplace") || id.includes("marketplace")) return "marketplace";
  if (label.includes("workspace") || id.includes("workspace")) return "workspace";
  if (label === "bank" || id.includes("bank")) return "bank";
  if (label === "knowledge" || id.includes("knowledge")) return "knowledge";
  if (label === "automations" || id.includes("automation")) return "automations";
  if (label === "artifacts" || id.includes("artifact")) return "artifact";
  if (label === "tools" || id.includes(":tools")) return "tool";
  if (label === "wiki") return "wiki";
  if (label === "rules") return "rule";
  if (label === "hooks") return "hook";
  if (label === "tasks") return "task";
  if (label === "calendar") return "calendar";
  if (label === "structure") return "structure";

  if (isGraphNodeKind(input.kind) && isGraphGlyphKey(input.kind)) {
    return input.kind;
  }
  return "system";
}

export function colorFamilyForNode(input: GraphGlyphInput): KindColorFamily {
  const ot = (input.objectType ?? "").trim();
  if (ot && ROLE_COLOR_FAMILY[ot]) return ROLE_COLOR_FAMILY[ot];

  // Glyph-based family when objectType missing but role is clear from id/label.
  const glyph = resolveGraphGlyphKey(input);
  const glyphFamily: Partial<Record<GraphGlyphKey, KindColorFamily>> = {
    life: ROLE_COLOR_FAMILY.LifeSurface,
    vault: ROLE_COLOR_FAMILY.VaultSecret,
    heart: ROLE_COLOR_FAMILY.BridgeConnection,
    support: ROLE_COLOR_FAMILY.Support,
    shared: ROLE_COLOR_FAMILY.SharedSurface,
    marketplace: ROLE_COLOR_FAMILY.Marketplace,
    workspace: ROLE_COLOR_FAMILY.Workspace,
    artifact: ROLE_COLOR_FAMILY.Artifact,
    agents: ROLE_COLOR_FAMILY.Agent,
    bank: ROLE_COLOR_FAMILY.FinanceConnection,
    knowledge: ROLE_COLOR_FAMILY.Memory,
    automations: ROLE_COLOR_FAMILY.Workflow,
    wiki: ROLE_COLOR_FAMILY.WikiPage,
    rule: ROLE_COLOR_FAMILY.AgentRule,
    hook: ROLE_COLOR_FAMILY.Hook,
    task: ROLE_COLOR_FAMILY.Task,
    pack: ROLE_COLOR_FAMILY.Marketplace,
    connector: ROLE_COLOR_FAMILY.Marketplace,
    tickets: ROLE_COLOR_FAMILY.Support,
    network: ROLE_COLOR_FAMILY.SharedSurface,
    grants: ROLE_COLOR_FAMILY.SharedSurface,
  };
  if (glyphFamily[glyph]) return glyphFamily[glyph]!;

  return isGraphNodeKind(input.kind)
    ? KIND_COLOR_FAMILY[input.kind]
    : DEFAULT_FAMILY;
}

export function kindColorFamily(kind: string): KindColorFamily {
  return isGraphNodeKind(kind) ? KIND_COLOR_FAMILY[kind] : DEFAULT_FAMILY;
}

/** Stable 32-bit hash for shade selection. */
export function hashNodeId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
  } else if (hh < 120) {
    r = x;
    g = c;
  } else if (hh < 180) {
    g = c;
    b = x;
  } else if (hh < 240) {
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function parseHexToHsl(
  hex: string
): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / d + 2) * 60;
      break;
    default:
      h = ((r - g) / d + 4) * 60;
      break;
  }
  return { h, s: s * 100, l: l * 100 };
}

function sameHueFamily(a: number, b: number): boolean {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d) < 28;
}

/** Spine-only colors (e.g. white You) must not wash role families on descendants. */
function isSpineReservedColor(hex: string): boolean {
  const hsl = parseHexToHsl(hex);
  return hsl !== null && hsl.l >= 92 && hsl.s <= 8;
}

/**
 * Instance color for a graph node (role family + parent-derived shade).
 */
export function graphNodeColor(
  kind: string,
  nodeId: string,
  parentColor?: string | null,
  objectType?: string | null,
  label?: string | null
): string {
  // Only the You hub is white. Other User/person nodes keep the green family.
  if (nodeId === "hub:you") return "#ffffff";

  const family = colorFamilyForNode({
    kind,
    objectType,
    id: nodeId,
    label: label ?? undefined,
  });
  const hash = hashNodeId(nodeId);
  const t = (hash % 1000) / 999;
  let l = family.lMin + t * (family.lMax - family.lMin);
  let s = family.s;
  const h = family.h;

  if (parentColor && !isSpineReservedColor(parentColor)) {
    const parent = parseHexToHsl(parentColor);
    if (parent) {
      if (sameHueFamily(h, parent.h)) {
        const step = 5 + (hash % 14);
        const dir = hash & 1 ? 1 : -1;
        l = clamp(parent.l + dir * step, family.lMin, family.lMax);
        s = clamp(family.s * 0.92 + parent.s * 0.08, 20, 100);
      } else {
        l = clamp(l * 0.62 + parent.l * 0.38, family.lMin, family.lMax);
        s = clamp(s * 0.88 + parent.s * 0.12, 15, 100);
      }
    }
  }

  return hslToHex(h, s, l);
}

export function graphKindColor(kind: string): string {
  return kindColorFamily(kind).canonical;
}

export function buildGraphNodeColors(
  nodes: Array<{
    id: string;
    kind: string;
    objectType?: string;
    label?: string;
  }>,
  edges: Array<{ source: string; target: string }>
): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    if (!parentOf.has(e.target) && byId.has(e.source) && byId.has(e.target)) {
      parentOf.set(e.target, e.source);
    }
  }

  const colors = new Map<string, string>();
  const visiting = new Set<string>();

  const resolve = (id: string): string => {
    const cached = colors.get(id);
    if (cached) return cached;
    if (visiting.has(id)) {
      const n = byId.get(id);
      return graphNodeColor(n?.kind ?? "system", id, null, n?.objectType, n?.label);
    }
    visiting.add(id);
    const node = byId.get(id);
    if (!node) {
      visiting.delete(id);
      return graphKindColor("system");
    }
    const parentId = parentOf.get(id);
    const parentColor = parentId ? resolve(parentId) : null;
    const color = graphNodeColor(
      node.kind,
      node.id,
      parentColor,
      node.objectType,
      node.label
    );
    colors.set(id, color);
    visiting.delete(id);
    return color;
  };

  for (const n of nodes) resolve(n.id);
  return colors;
}
