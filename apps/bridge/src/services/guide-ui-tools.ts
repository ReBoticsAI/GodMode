/**
 * Welcome-guide UI tools: least-privilege surfaces Intelligence can open
 * during signup-guide / orientation chat (Graph focus + floating windows).
 *
 * Client applies `uiAction` from tool results via the same godmode:open-* /
 * focus events Graph CTAs already use.
 */

export type GraphTourStop = {
  nodeId: string;
  label: string;
  say: string;
};

export type GuideUiAction =
  | {
      type: "open_surface";
      tab: string;
      vault?: string;
      sub?: string;
      label: string;
    }
  | { type: "focus_node"; nodeId: string; label: string }
  | { type: "graph_tour"; dwellMs: number; stops: GraphTourStop[] }
  | {
      type: "guide_choice";
      question: string;
      why: string;
      options: Array<{ id: string; label: string }>;
    };

/** How long the Graph stays on one tour stop before moving. */
export const GRAPH_TOUR_DWELL_MS = 10_000;
export const GRAPH_TOUR_MAX_STOPS = 6;

/** Tools allowed when signup-guide mode is active (hard RBAC for the trial turn). */
export const SIGNUP_GUIDE_TOOL_ALLOW = [
  "open_guide_surface",
  "focus_graph_node",
  "play_graph_tour",
  "ask_guide_choice",
  "read_wiki_page",
] as const;

export type SignupGuideToolName = (typeof SIGNUP_GUIDE_TOOL_ALLOW)[number];

const SIGNUP_GUIDE_TOOL_SET = new Set<string>(SIGNUP_GUIDE_TOOL_ALLOW);

export function isSignupGuideToolName(name: string): boolean {
  return SIGNUP_GUIDE_TOOL_SET.has(name);
}

/** Drop non-guide schemas for a trial welcome-guide turn. */
export function filterSchemasForSignupGuide<
  T extends { function: { name: string } },
>(schemas: T[]): T[] {
  return schemas.filter((s) => isSignupGuideToolName(s.function.name));
}

type GuideSurfaceDef = {
  id: string;
  aliases: string[];
  label: string;
  action: GuideUiAction;
  description: string;
};

/**
 * Allowlisted destinations the model may open. Keep this list small and
 * onboarding-oriented; do not expose Admin / coding / marketplace here.
 */
export const GUIDE_SURFACES: readonly GuideSurfaceDef[] = [
  {
    id: "godmode_inference",
    aliases: [
      "inference",
      "buy inference",
      "buy more",
      "pricing",
      "packs",
      "subscription",
      "subscriptions",
      "godmode inference",
    ],
    label: "GodMode Inference (buy more)",
    description:
      "Platform Vault → Inference → GodMode packs and subscriptions (live prices).",
    action: {
      type: "open_surface",
      tab: "platform-vault",
      vault: "inference",
      sub: "godmode",
      label: "GodMode Inference (buy more)",
    },
  },
  {
    id: "supported_byok",
    aliases: [
      "byok",
      "supported",
      "paste key",
      "deepseek",
      "z.ai",
      "zai",
      "qwen",
      "connect key",
    ],
    label: "Supported BYOK keys",
    description:
      "Platform Vault → Inference → Supported (paste DeepSeek / Z.AI / Qwen keys).",
    action: {
      type: "open_surface",
      tab: "platform-vault",
      vault: "inference",
      sub: "supported",
      label: "Supported BYOK keys",
    },
  },
  {
    id: "platform_vault",
    aliases: ["platform vault", "cloud vault"],
    label: "Platform Vault",
    description: "Account Connect secrets and Inference settings.",
    action: {
      type: "open_surface",
      tab: "platform-vault",
      label: "Platform Vault",
    },
  },
  {
    id: "personal_vault",
    aliases: ["personal vault", "user vault", "vault"],
    label: "Personal Vault",
    description: "Your personal Vault (integrations and secrets).",
    action: {
      type: "open_surface",
      tab: "personal-vault",
      label: "Personal Vault",
    },
  },
  {
    id: "bank",
    aliases: ["bank", "wallet", "credits"],
    label: "Bank",
    description: "Bank / credits surface on the Graph.",
    action: { type: "open_surface", tab: "bank", label: "Bank" },
  },
  {
    id: "wiki",
    aliases: ["wiki", "docs", "documentation"],
    label: "Wiki",
    description: "Hub Wiki knowledge base.",
    action: { type: "open_surface", tab: "wiki", label: "Wiki" },
  },
  {
    id: "intelligence_chat",
    aliases: ["chat", "intelligence chat", "ask intelligence"],
    label: "Intelligence chat",
    description: "Focus Intelligence and keep the chat panel open.",
    action: {
      type: "open_surface",
      tab: "chat",
      label: "Intelligence chat",
    },
  },
] as const;

type GuideNodeDef = {
  id: string;
  aliases: string[];
  label: string;
  nodeId: string;
};

export const GUIDE_GRAPH_NODES: readonly GuideNodeDef[] = [
  {
    id: "you",
    aliases: ["you", "me", "user", "profile"],
    label: "You",
    nodeId: "hub:you",
  },
  {
    id: "hub",
    aliases: ["hub", "heart"],
    label: "Hub",
    nodeId: "hub:heart",
  },
  {
    id: "intelligence",
    aliases: ["intelligence", "ai", "assistant"],
    label: "Intelligence",
    nodeId: "hub:intelligence",
  },
  {
    id: "platform_vault",
    aliases: ["platform vault", "cloud vault"],
    label: "Platform Vault",
    nodeId: "hub:vault-platform",
  },
  {
    id: "personal_vault",
    aliases: ["personal vault", "user vault", "vault"],
    label: "Personal Vault",
    nodeId: "hub:vault-you",
  },
  {
    id: "bank",
    aliases: ["bank"],
    label: "Bank",
    nodeId: "hub:bank-you",
  },
  {
    id: "wiki",
    aliases: ["wiki"],
    label: "Wiki",
    nodeId: "hub:wiki",
  },
  {
    id: "workspaces",
    aliases: ["workspaces", "workspace"],
    label: "Workspaces",
    nodeId: "hub:workspace",
  },
  {
    id: "marketplace",
    aliases: ["marketplace", "market", "sell"],
    label: "Marketplace",
    nodeId: "hub:marketplace",
  },
] as const;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function matchByIdOrAlias<T extends { id: string; aliases: string[] }>(
  list: readonly T[],
  raw: string
): T | undefined {
  const q = norm(raw);
  if (!q) return undefined;
  const exact = list.find(
    (item) =>
      norm(item.id) === q || item.aliases.some((a) => norm(a) === q)
  );
  if (exact) return exact;
  // Prefer longest alias contained in the query (e.g. "buy more inference").
  let best: T | undefined;
  let bestLen = 0;
  for (const item of list) {
    for (const a of [item.id, ...item.aliases]) {
      const n = norm(a);
      if (n.length >= 3 && q.includes(n) && n.length > bestLen) {
        best = item;
        bestLen = n.length;
      }
    }
  }
  return best;
}

export const GUIDE_NEXT_QUESTION = "How do you want to move forward?";

export const GUIDE_NEXT_WHY =
  "Local with Inference keeps GodMode on your computer and adds the models. Cloud with Inference hosts the workspace and the models, so you are not running it on this machine. Inference alone is the model supply. Cloud alone is the hosted workspace. Seller is how a local install sells on marketplace.";

export const GUIDE_NEXT_OPTIONS = [
  { id: "download", label: "Download for my computer" },
  { id: "inference", label: "GodMode Inference" },
  { id: "cloud", label: "GodMode Cloud" },
  { id: "cloud_inference", label: "Cloud with Inference" },
  { id: "seller", label: "GodMode Seller" },
] as const;

export function resolveGuideChoice(): {
  ok: true;
  uiAction: GuideUiAction;
  message: string;
} {
  return {
    ok: true,
    uiAction: {
      type: "guide_choice",
      question: GUIDE_NEXT_QUESTION,
      why: GUIDE_NEXT_WHY,
      options: GUIDE_NEXT_OPTIONS.map((option) => ({ ...option })),
    },
    message:
      "Choice buttons are on screen. Do not repeat the options or write a signup paragraph.",
  };
}

export function resolveGuideSurface(surface: string): {
  ok: true;
  uiAction: GuideUiAction;
  message: string;
} | {
  ok: false;
  error: string;
  available: string[];
} {
  const hit = matchByIdOrAlias(GUIDE_SURFACES, surface);
  if (!hit) {
    return {
      ok: false,
      error: `Unknown guide surface "${surface}".`,
      available: GUIDE_SURFACES.map((s) => s.id),
    };
  }
  return {
    ok: true,
    uiAction: hit.action,
    message: `Opening ${hit.label} for the user.`,
  };
}

export function resolveGuideGraphNode(node: string): {
  ok: true;
  uiAction: GuideUiAction;
  message: string;
} | {
  ok: false;
  error: string;
  available: string[];
} {
  const raw = node.trim();
  if (raw.startsWith("hub:")) {
    return {
      ok: true,
      uiAction: {
        type: "focus_node",
        nodeId: raw,
        label: raw,
      },
      message: `Focusing Graph node ${raw}.`,
    };
  }
  const hit = matchByIdOrAlias(GUIDE_GRAPH_NODES, raw);
  if (!hit) {
    return {
      ok: false,
      error: `Unknown Graph node "${node}".`,
      available: GUIDE_GRAPH_NODES.map((n) => n.id),
    };
  }
  return {
    ok: true,
    uiAction: {
      type: "focus_node",
      nodeId: hit.nodeId,
      label: hit.label,
    },
    message: `Focusing ${hit.label} on the Graph.`,
  };
}

/**
 * Validate a mini-tour. Unknown nodes are dropped. The client shows one stop
 * at a time for GRAPH_TOUR_DWELL_MS, then moves to the next.
 */
export function resolveGraphTour(rawStops: unknown): {
  ok: true;
  uiAction: GuideUiAction;
  message: string;
} | {
  ok: false;
  error: string;
  available: string[];
} {
  const available = GUIDE_GRAPH_NODES.map((n) => n.id);
  if (!Array.isArray(rawStops)) {
    return { ok: false, error: "stops must be a list of { node, say }.", available };
  }
  const stops: GraphTourStop[] = [];
  for (const item of rawStops) {
    if (stops.length >= GRAPH_TOUR_MAX_STOPS) break;
    if (!item || typeof item !== "object") continue;
    const record = item as { node?: unknown; say?: unknown };
    const node = typeof record.node === "string" ? record.node.trim() : "";
    const say = typeof record.say === "string" ? record.say.trim().slice(0, 280) : "";
    if (!node || !say) continue;
    const resolved = resolveGuideGraphNode(node);
    if (!resolved.ok || resolved.uiAction.type !== "focus_node") continue;
    stops.push({
      nodeId: resolved.uiAction.nodeId,
      label: resolved.uiAction.label,
      say,
    });
  }
  if (stops.length < 2) {
    return {
      ok: false,
      error: "A tour needs at least two known Graph nodes, each with one sentence.",
      available,
    };
  }
  return {
    ok: true,
    uiAction: { type: "graph_tour", dwellMs: GRAPH_TOUR_DWELL_MS, stops },
    message: `Tour queued: ${stops.map((s) => s.label).join(", ")}. Each stop stays for 10 seconds and the chat shows that sentence then. Do not repeat those sentences. After this, one short close: sign up for GodMode Inference, or GodMode Cloud with Inference.`,
  };
}

export function guideSurfacesCatalogText(): string {
  return GUIDE_SURFACES.map(
    (s) => `- ${s.id}: ${s.description}`
  ).join("\n");
}

export function guideNodesCatalogText(): string {
  return GUIDE_GRAPH_NODES.map(
    (n) => `- ${n.id} → ${n.nodeId} (${n.label})`
  ).join("\n");
}
