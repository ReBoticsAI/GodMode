/**
 * Versioned GodMode architecture catalog for The Graph (SQLite-universe topology).
 * Public-safe: prose + structure only. No secrets or tenant row dumps.
 * Unlock hubs are intentionally absent.
 *
 * Account, Cloud, and LLM keys are described on You's Information panel (not
 * Graph nodes). Vault is secrets plus Bank (with Wallet). Life fans from each
 * owner. Chat bubbles sit left of You and Intelligence, and off each
 * specialized agent under Workspaces (not off the workspace root). Hub sits on
 * the right; Support, Shared, Marketplace, and Workspaces extend further right.
 * You and Intelligence connect only through Hub (no direct spine edge).
 * Research and Ops sit on the platform plane under Intelligence visually,
 * but each links to Hub (not Intelligence) and owns Vault + Life + Chat.
 * Other exemplar agents (Builder, Coordinator) live under Workspaces.
 */

export const ARCHITECTURE_CATALOG_VERSION = 24;

export type GraphCtaAction =
  | { type: "open_chat" }
  | { type: "open_panel"; tab: string }
  | { type: "navigate"; path: string }
  | { type: "open_auth" }
  | { type: "open_unlock"; capability?: string }
  | { type: "none" };

/** Recipe for floating windows when this node is activated. */
export type GraphWindowSpec = {
  kind: "chat" | "information" | "canvas" | string;
  width?: number;
  height?: number;
  placement?: "left" | "right" | "center";
  agentId?: string;
  title?: string;
};

const CHAT_AND_INFO: GraphWindowSpec[] = [
  { kind: "chat", placement: "left", width: 560, height: 480 },
  { kind: "information", placement: "right", width: 400, height: 520 },
];

const INFO_ONLY: GraphWindowSpec[] = [
  { kind: "information", placement: "right", width: 400, height: 520 },
];

export type ArchitectureCatalogNode = {
  id: string;
  kind:
    | "chat"
    | "agent"
    | "user"
    | "memory"
    | "skill"
    | "tool"
    | "workflow"
    | "schedule"
    | "page"
    | "unlock"
    | "system";
  label: string;
  objectType?: string;
  refId?: string;
  position: { x: number; y: number; z: number };
  description: string;
  securityNote: string;
  connectionLabels: string[];
  ctaLabel: string;
  cta: GraphCtaAction;
  /** When true, single-click opens the live surface instead of inspect-only. */
  openImmediate?: boolean;
  /** Floating windows to spawn on activate. */
  windows?: GraphWindowSpec[];
};

export type ArchitectureCatalogEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
};

type Vec3 = { x: number; y: number; z: number };

function offset(base: Vec3, dx: number, dy: number, dz = 0): Vec3 {
  return { x: base.x + dx, y: base.y + dy, z: base.z + dz };
}

type Side = "you" | "intelligence" | "research" | "ops";

const SIDE_OWNER_ID: Record<Side, string> = {
  you: "hub:you",
  intelligence: "hub:intelligence",
  research: "hub:agent-research",
  ops: "hub:agent-ops",
};

const SIDE_EDGE_PREFIX: Record<Side, string> = {
  you: "you",
  intelligence: "intel",
  research: "research",
  ops: "ops",
};

function sideLabel(side: Side, noun: string): string {
  if (side === "you") return `Your ${noun}`;
  return `${ownerLabel(side)} ${noun}`;
}

function ownerLabel(side: Side): string {
  switch (side) {
    case "you":
      return "You";
    case "intelligence":
      return "Intelligence";
    case "research":
      return "Research";
    case "ops":
      return "Ops";
  }
}

/**
 * Life + Structure/Knowledge/Automations/Calendar trees for one side.
 * growY: +1 fans away upward (You), -1 fans away downward (Intelligence)
 * so Life never piles back onto the owner hub.
 */
function lifeSurfaceNodes(
  side: Side,
  lifePos: Vec3,
  growY: 1 | -1
): ArchitectureCatalogNode[] {
  const suffix = side;
  const owner = ownerLabel(side);
  const lifeId = `hub:life-${suffix}`;
  const structureId = `hub:structure-${suffix}`;
  const knowledgeId = `hub:knowledge-${suffix}`;
  const autoId = `hub:automations-${suffix}`;
  const calId = `hub:calendar-${suffix}`;
  const gy = growY;

  // Primary Life children: wide XY fan, all growing away from the owner.
  const structurePos = offset(lifePos, 2.2, gy * 1.6, 1.2);
  const knowledgePos = offset(lifePos, 0.7, gy * 1.9, -1.3);
  const autoPos = offset(lifePos, -1.8, gy * 1.5, -1.1);
  const calPos = offset(lifePos, -2.8, gy * 1.2, 1.1);

  return [
    {
      id: lifeId,
      kind: "system",
      label: "Life",
      objectType: "LifeSurface",
      refId: `life-${suffix}`,
      position: lifePos,
      description:
        side === "you"
          ? "Your living surfaces: Structure, Knowledge, Automations, and Calendar. The personal OS body around You (not Vault secrets)."
          : `${owner}'s living surfaces: Structure, Knowledge, Automations, and Calendar. Parallel Life body for this agent on The Graph.`,
      securityNote:
        "Life is a map hub. Durable rows live in surface SQLite files after auth.",
      connectionLabels: [
        owner,
        "Structure",
        "Knowledge",
        "Automations",
        "Calendar",
      ],
      ctaLabel: "Inspect Life",
      cta: { type: "none" },
      windows: INFO_ONLY,
    },
    {
      id: structureId,
      kind: "page",
      label: "Structure",
      objectType: "StructureNode",
      refId: `structure-${suffix}`,
      position: structurePos,
      description:
        side === "you"
          ? "Your anatomy: departments (regions), divisions, and pages (surfaces)."
          : `${owner}'s anatomy view: how it grows departments, divisions, and pages.`,
      securityNote: `${sideLabel(side, "Structure")} is separate from other owners' Structure.`,
      connectionLabels: [sideLabel(side, "Life"), "Departments", "Divisions", "Pages"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:departments-${suffix}`,
      kind: "page",
      label: "Departments",
      objectType: "StructureNode",
      refId: `departments-${suffix}`,
      position: offset(structurePos, 1.8, gy * 1.3, 1.0),
      description: "Regions of the anatomy tree. New workspaces start with none.",
      securityNote: "Department rows require auth; Graph shows structure only.",
      connectionLabels: ["Structure"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:divisions-${suffix}`,
      kind: "page",
      label: "Divisions",
      objectType: "StructureNode",
      refId: `divisions-${suffix}`,
      position: offset(structurePos, 2.4, gy * 0.2, -0.2),
      description: "Groups of work inside a department region.",
      securityNote: "Division rows require auth.",
      connectionLabels: ["Structure"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:pages-${suffix}`,
      kind: "page",
      label: "Pages",
      objectType: "StructureNode",
      refId: `pages-${suffix}`,
      position: offset(structurePos, 2.2, gy * 1.2, -1.8),
      description: "Surfaces you use: wiki, tools, records, and custom page kinds.",
      securityNote: "Page bodies stay in workspace / surface stores.",
      connectionLabels: ["Structure"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: knowledgeId,
      kind: "memory",
      label: "Knowledge",
      objectType: "Memory",
      refId: `knowledge-${suffix}`,
      position: knowledgePos,
      description:
        "Memories, rules, skills, artifacts, tools, and wiki under this owner.",
      securityNote: "Live memory and rule text stay off The Graph.",
      connectionLabels: [
        sideLabel(side, "Life"),
        "Memories",
        "Rules",
        "Skills",
        "Artifacts",
        "Tools",
        "Wiki",
      ],
      ctaLabel: "Open Knowledge",
      cta: { type: "open_panel", tab: "knowledge" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:memories-${suffix}`,
      kind: "memory",
      label: "Memories",
      objectType: "Memory",
      refId: `memories-${suffix}`,
      position: offset(knowledgePos, 1.8, gy * 1.4, -0.8),
      description: "Durable memory entries retrieved into chat context.",
      securityNote: "Memory bodies never appear on The Graph.",
      connectionLabels: ["Knowledge"],
      ctaLabel: "Open Knowledge",
      cta: { type: "open_panel", tab: "knowledge" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:rules-${suffix}`,
      kind: "skill",
      label: "Rules",
      objectType: "AgentRule",
      refId: `rules-${suffix}`,
      position: offset(knowledgePos, 0.3, gy * 1.7, 1.0),
      description: "Behavior constraints attached to this owner's agents.",
      securityNote: "Rule text stays in Knowledge APIs after auth.",
      connectionLabels: ["Knowledge"],
      ctaLabel: "Open Knowledge",
      cta: { type: "open_panel", tab: "knowledge" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:skills-${suffix}`,
      kind: "skill",
      label: "Skills",
      objectType: "AgentSkill",
      refId: `skills-${suffix}`,
      position: offset(knowledgePos, -0.9, gy * 1.5, -1.1),
      description: "Reusable playbooks agents can invoke.",
      securityNote: "Skill bodies stay off The Graph.",
      connectionLabels: ["Knowledge"],
      ctaLabel: "Open Knowledge",
      cta: { type: "open_panel", tab: "knowledge" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:artifacts-${suffix}`,
      kind: "tool",
      label: "Artifacts",
      objectType: "Artifact",
      refId: `artifacts-${suffix}`,
      position: offset(knowledgePos, -1.7, gy * 1.1, 0.6),
      description: "Generated outputs linked to agent work.",
      securityNote: "Artifact contents require auth.",
      connectionLabels: ["Knowledge"],
      ctaLabel: "Open Knowledge",
      cta: { type: "open_panel", tab: "knowledge" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:tools-${suffix}`,
      kind: "tool",
      label: "Tools",
      objectType: "ToolDefinition",
      refId: `tools-${suffix}`,
      position: offset(knowledgePos, -0.6, gy * 0.6, 2.8),
      description: "Callable tools available to this owner's agents.",
      securityNote: "Tool allow-lists bound what Hub will execute.",
      connectionLabels: ["Knowledge"],
      ctaLabel: "Open Knowledge",
      cta: { type: "open_panel", tab: "knowledge" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:wiki-${suffix}`,
      kind: "page",
      label: "Wiki",
      objectType: "WikiPage",
      refId: `wiki-${suffix}`,
      position: offset(knowledgePos, -1.8, gy * 2.5, 0.5),
      description: "Wiki pages in the knowledge plane for RAG and reference.",
      securityNote: "Wiki bodies stay in surface / workspace stores.",
      connectionLabels: ["Knowledge"],
      ctaLabel: "Open Knowledge",
      cta: { type: "open_panel", tab: "knowledge" },
      windows: INFO_ONLY,
    },
    {
      id: autoId,
      kind: "workflow",
      label: "Automations",
      objectType: "Workflow",
      refId: `automations-${suffix}`,
      position: autoPos,
      description: "Workflows, schedules, and hooks under this owner.",
      securityNote: "Runs under Hub with auth and tool policy.",
      connectionLabels: [
        sideLabel(side, "Life"),
        "Workflows",
        "Schedules",
        "Hooks",
      ],
      ctaLabel: "Open Automations",
      cta: { type: "open_panel", tab: "projects" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:workflows-${suffix}`,
      kind: "workflow",
      label: "Workflows",
      objectType: "Workflow",
      refId: `workflows-${suffix}`,
      position: offset(autoPos, -1.6, gy * 1.4, -0.7),
      description: "Multi-step automation definitions.",
      securityNote: "Workflow specs require auth.",
      connectionLabels: ["Automations"],
      ctaLabel: "Open Automations",
      cta: { type: "open_panel", tab: "projects" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:schedules-${suffix}`,
      kind: "schedule",
      label: "Schedules",
      objectType: "Schedule",
      refId: `schedules-${suffix}`,
      position: offset(autoPos, -2.5, gy * 0.6, 0.9),
      description: "Cron and timed triggers for workflows.",
      securityNote: "Schedule payloads require auth.",
      connectionLabels: ["Automations"],
      ctaLabel: "Open Automations",
      cta: { type: "open_panel", tab: "projects" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:hooks-${suffix}`,
      kind: "workflow",
      label: "Hooks",
      objectType: "Hook",
      refId: `hooks-${suffix}`,
      position: offset(autoPos, -1.2, gy * 1.2, 1.1),
      description: "Event hooks that fire automations from platform events.",
      securityNote: "Hook configs require auth.",
      connectionLabels: ["Automations"],
      ctaLabel: "Open Automations",
      cta: { type: "open_panel", tab: "projects" },
      windows: INFO_ONLY,
    },
    {
      id: calId,
      kind: "schedule",
      label: "Calendar",
      objectType: "CalendarEvent",
      refId: `calendar-${suffix}`,
      position: calPos,
      description: "Time surface: events and linked tasks.",
      securityNote: "Event details require auth.",
      connectionLabels: [sideLabel(side, "Life"), "Events", "Tasks"],
      ctaLabel: "Open Calendar",
      cta: { type: "open_panel", tab: "calendar" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:events-${suffix}`,
      kind: "schedule",
      label: "Events",
      objectType: "CalendarEvent",
      refId: `events-${suffix}`,
      position: offset(calPos, -1.7, gy * 1.2, 0.8),
      description: "Calendar events on this owner's time surface.",
      securityNote: "Event bodies require auth.",
      connectionLabels: ["Calendar"],
      ctaLabel: "Open Calendar",
      cta: { type: "open_panel", tab: "calendar" },
      windows: INFO_ONLY,
    },
    {
      id: `hub:tasks-${suffix}`,
      kind: "page",
      label: "Tasks",
      objectType: "Task",
      refId: `tasks-${suffix}`,
      position: offset(calPos, -2.4, gy * -0.2, -1.6),
      description: "Tasks linked to calendar and work surfaces.",
      securityNote: "Task details require auth.",
      connectionLabels: ["Calendar"],
      ctaLabel: "Open Calendar",
      cta: { type: "open_panel", tab: "calendar" },
      windows: INFO_ONLY,
    },
  ];
}

function lifeSurfaceEdges(side: Side): ArchitectureCatalogEdge[] {
  const s = side;
  const life = `hub:life-${s}`;
  const structure = `hub:structure-${s}`;
  const knowledge = `hub:knowledge-${s}`;
  const auto = `hub:automations-${s}`;
  const cal = `hub:calendar-${s}`;
  const owner = SIDE_OWNER_ID[side];
  const p = SIDE_EDGE_PREFIX[side];

  return [
    { id: `e:${p}-life`, source: owner, target: life, kind: "life" },
    { id: `e:life-${s}-structure`, source: life, target: structure, kind: "surface" },
    { id: `e:life-${s}-knowledge`, source: life, target: knowledge, kind: "surface" },
    { id: `e:life-${s}-auto`, source: life, target: auto, kind: "surface" },
    { id: `e:life-${s}-cal`, source: life, target: cal, kind: "surface" },

    {
      id: `e:structure-${s}-departments`,
      source: structure,
      target: `hub:departments-${s}`,
      kind: "structure-child",
    },
    {
      id: `e:structure-${s}-divisions`,
      source: structure,
      target: `hub:divisions-${s}`,
      kind: "structure-child",
    },
    {
      id: `e:structure-${s}-pages`,
      source: structure,
      target: `hub:pages-${s}`,
      kind: "structure-child",
    },

    {
      id: `e:knowledge-${s}-memories`,
      source: knowledge,
      target: `hub:memories-${s}`,
      kind: "knowledge-child",
    },
    {
      id: `e:knowledge-${s}-rules`,
      source: knowledge,
      target: `hub:rules-${s}`,
      kind: "knowledge-child",
    },
    {
      id: `e:knowledge-${s}-skills`,
      source: knowledge,
      target: `hub:skills-${s}`,
      kind: "knowledge-child",
    },
    {
      id: `e:knowledge-${s}-artifacts`,
      source: knowledge,
      target: `hub:artifacts-${s}`,
      kind: "knowledge-child",
    },
    {
      id: `e:knowledge-${s}-tools`,
      source: knowledge,
      target: `hub:tools-${s}`,
      kind: "knowledge-child",
    },
    {
      id: `e:knowledge-${s}-wiki`,
      source: knowledge,
      target: `hub:wiki-${s}`,
      kind: "knowledge-child",
    },

    {
      id: `e:auto-${s}-workflows`,
      source: auto,
      target: `hub:workflows-${s}`,
      kind: "automation-child",
    },
    {
      id: `e:auto-${s}-schedules`,
      source: auto,
      target: `hub:schedules-${s}`,
      kind: "automation-child",
    },
    {
      id: `e:auto-${s}-hooks`,
      source: auto,
      target: `hub:hooks-${s}`,
      kind: "automation-child",
    },

    {
      id: `e:cal-${s}-events`,
      source: cal,
      target: `hub:events-${s}`,
      kind: "calendar-child",
    },
    {
      id: `e:cal-${s}-tasks`,
      source: cal,
      target: `hub:tasks-${s}`,
      kind: "calendar-child",
    },
  ];
}

function agentChatWindows(agentId: string): GraphWindowSpec[] {
  return [
    {
      kind: "chat",
      placement: "left",
      width: 560,
      height: 480,
      agentId,
    },
    { kind: "information", placement: "right", width: 400, height: 520 },
  ];
}

/**
 * Vault → Bank → Wallet plane for an agent (or You) on The Graph.
 */
function agentVaultNodes(opts: {
  suffix: string;
  ownerId: string;
  ownerLabel: string;
  vaultLabel: string;
  position: Vec3;
}): ArchitectureCatalogNode[] {
  const vaultId = `hub:vault-${opts.suffix}`;
  const bankId = `hub:bank-${opts.suffix}`;
  const walletId = `hub:wallet-${opts.suffix}`;
  const bankPos = offset(opts.position, -1.0, 0, -1.2);
  const walletPos = offset(opts.position, -2.6, 0, -1.7);

  return [
    {
      id: vaultId,
      kind: "system",
      label: opts.vaultLabel,
      objectType: "VaultSecret",
      refId: `vault-${opts.suffix}`,
      position: opts.position,
      description: `${opts.ownerLabel}'s Vault: approved agent secrets and Bank. Distinct from other owners' Vaults.`,
      securityNote: "Agent-scoped secrets. Values never appear on The Graph.",
      connectionLabels: [opts.ownerLabel, "Bank"],
      ctaLabel: "Open Agent Vault",
      cta: { type: "open_panel", tab: "vault" },
      windows: INFO_ONLY,
    },
    {
      id: bankId,
      kind: "system",
      label: "Bank",
      objectType: "FinanceConnection",
      refId: `bank-${opts.suffix}`,
      position: bankPos,
      description: `${opts.ownerLabel} finance connections under ${opts.vaultLabel}. Wallet sits under Bank.`,
      securityNote: "No balances on the public graph.",
      connectionLabels: [opts.vaultLabel, "Wallet"],
      ctaLabel: "Open Bank",
      cta: { type: "open_panel", tab: "bank" },
      windows: INFO_ONLY,
    },
    {
      id: walletId,
      kind: "system",
      label: "Wallet",
      objectType: "Wallet",
      refId: `wallet-${opts.suffix}`,
      position: walletPos,
      description: `${opts.ownerLabel}'s connected wallets under its Bank. Agent-scoped holdings.`,
      securityNote: "Addresses and balances stay off The Graph.",
      connectionLabels: ["Bank"],
      ctaLabel: "Open Vault wallets",
      cta: { type: "open_panel", tab: "vault" },
      windows: INFO_ONLY,
    },
  ];
}

function agentVaultEdges(suffix: string, ownerId: string): ArchitectureCatalogEdge[] {
  const p = suffix === "intelligence" ? "intel" : suffix;
  return [
    {
      id: `e:${p}-vault`,
      source: ownerId,
      target: `hub:vault-${suffix}`,
      kind: "vault",
    },
    {
      id: `e:vault-${p}-bank`,
      source: `hub:vault-${suffix}`,
      target: `hub:bank-${suffix}`,
      kind: "vault-child",
    },
    {
      id: `e:bank-${p}-wallet`,
      source: `hub:bank-${suffix}`,
      target: `hub:wallet-${suffix}`,
      kind: "bank-child",
    },
  ];
}

/**
 * Research and Ops on the platform plane (stacked below Intelligence visually).
 * Each links to Hub, not Intelligence, and owns Vault + Life + Chat.
 */
function platformSpineAgentNodes(): ArchitectureCatalogNode[] {
  // Stacked under Intelligence (y=-0.2); tight spacing while Life/Vault stay collapsed.
  const researchPos = { x: 0, y: -1.35, z: 0 };
  const opsPos = { x: 0, y: -2.5, z: 0 };

  return [
    {
      id: "hub:agent-research",
      kind: "agent",
      label: "Research",
      objectType: "Agent",
      refId: "research",
      position: researchPos,
      description:
        "Platform research agent on the Intelligence plane. Links to Hub (Bridge), not Intelligence. Owns Vault, Life, and Chat. Runs scoped research jobs through Hub.",
      securityNote: "No secret values on The Graph.",
      connectionLabels: ["Hub", "Research Vault", "Life", "Chat"],
      ctaLabel: "Chat with Research",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: agentChatWindows("research"),
    },
    ...agentVaultNodes({
      suffix: "research",
      ownerId: "hub:agent-research",
      ownerLabel: "Research",
      vaultLabel: "Research Vault",
      position: offset(researchPos, -3.6, 0, 0.2),
    }),
    ...lifeSurfaceNodes("research", offset(researchPos, 3.6, 0, 0), -1),
    agentChatBubble({
      id: "hub:chat-agent-research",
      agentId: "research",
      agentLabel: "Research",
      position: offset(researchPos, -1.8, 0.8, 0),
    }),
    {
      id: "hub:agent-ops",
      kind: "agent",
      label: "Ops",
      objectType: "Agent",
      refId: "ops",
      position: opsPos,
      description:
        "Platform ops agent on the Intelligence plane. Links to Hub (Bridge), not Intelligence. Owns Vault, Life, and Chat. Handles recurring operational work through Hub.",
      securityNote: "No secret values on The Graph.",
      connectionLabels: ["Hub", "Ops Vault", "Life", "Chat"],
      ctaLabel: "Chat with Ops",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: agentChatWindows("ops"),
    },
    ...agentVaultNodes({
      suffix: "ops",
      ownerId: "hub:agent-ops",
      ownerLabel: "Ops",
      vaultLabel: "Ops Vault",
      position: offset(opsPos, -3.6, 0, 0.2),
    }),
    ...lifeSurfaceNodes("ops", offset(opsPos, 3.6, 0, 0), -1),
    agentChatBubble({
      id: "hub:chat-agent-ops",
      agentId: "ops",
      agentLabel: "Ops",
      position: offset(opsPos, -1.8, 0.8, 0),
    }),
  ];
}

function platformSpineAgentEdges(): ArchitectureCatalogEdge[] {
  return [
    {
      id: "e:heart-research",
      source: "hub:heart",
      target: "hub:agent-research",
      kind: "runtime",
    },
    {
      id: "e:heart-ops",
      source: "hub:heart",
      target: "hub:agent-ops",
      kind: "runtime",
    },
    ...agentVaultEdges("research", "hub:agent-research"),
    ...agentVaultEdges("ops", "hub:agent-ops"),
    ...lifeSurfaceEdges("research"),
    ...lifeSurfaceEdges("ops"),
    {
      id: "e:research-chat",
      source: "hub:agent-research",
      target: "hub:chat-agent-research",
      kind: "chat-agent",
    },
    {
      id: "e:ops-chat",
      source: "hub:agent-ops",
      target: "hub:chat-agent-ops",
      kind: "chat-agent",
    },
  ];
}

/** Chat bubble hanging off a specialized agent (who you are talking to). */
function agentChatBubble(opts: {
  id: string;
  agentId: string;
  agentLabel: string;
  position: Vec3;
}): ArchitectureCatalogNode {
  return {
    id: opts.id,
    kind: "chat",
    label: "Chat",
    objectType: "ChatSession",
    refId: `${opts.agentId}-chat`,
    position: opts.position,
    description: `Chat with ${opts.agentLabel}. Connected to that agent on The Graph, not to the workspace root.`,
    securityNote: "Message bodies stay in chat SQLite files.",
    connectionLabels: [opts.agentLabel],
    ctaLabel: `Chat with ${opts.agentLabel}`,
    cta: { type: "open_chat" },
    openImmediate: true,
    windows: agentChatWindows(opts.agentId),
  };
}

/**
 * Catalog exemplar workspaces under the Workspaces hub (guest-safe map pins).
 * Personal fans up-right; Project Alpha fans down-right; Family fans further
 * right on the ray.
 */
function workspaceExemplarNodes(workspacesPos: Vec3): ArchitectureCatalogNode[] {
  const personalPos = offset(workspacesPos, 2.0, 1.8, 0);
  const projectPos = offset(workspacesPos, 2.0, -1.8, 0);
  const familyPos = offset(workspacesPos, 3.8, 0, 0.6);

  const personalStructurePos = offset(personalPos, 2.0, -0.7, -0.4);

  const projectAgentsPos = offset(projectPos, 2.0, -0.4, 0.2);
  const builderPos = offset(projectAgentsPos, 1.8, -0.5, 0.3);

  const familyAgentsPos = offset(familyPos, 2.0, 0.6, 0.2);
  const coordinatorPos = offset(familyAgentsPos, 1.8, 0.4, 0.3);

  return [
    {
      id: "hub:ws-personal",
      kind: "system",
      label: "Personal",
      objectType: "Workspace",
      refId: "ws-personal",
      position: personalPos,
      description:
        "Exemplar personal workspace. Holds Structure for this sandbox. Platform agents Research and Ops link to Hub on the platform plane, not under Personal. Live tenant workspaces enrich here when you are signed in.",
      securityNote:
        "Catalog pin only. Workspace rows stay in tenant SQLite files after auth.",
      connectionLabels: ["Workspaces", "Structure"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:structure-personal",
      kind: "page",
      label: "Structure",
      objectType: "StructureNode",
      refId: "structure-ws-personal",
      position: personalStructurePos,
      description:
        "Structure inside the Personal workspace: departments, divisions, and pages for this sandbox.",
      securityNote: "Structure rows require auth.",
      connectionLabels: ["Personal", "Departments"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:departments-personal",
      kind: "page",
      label: "Departments",
      objectType: "StructureNode",
      refId: "departments-ws-personal",
      position: offset(personalStructurePos, 1.6, -0.9, 0.3),
      description:
        "Department regions in the Personal workspace anatomy. New workspaces start with none.",
      securityNote: "Department rows require auth.",
      connectionLabels: ["Structure"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },

    {
      id: "hub:ws-project-alpha",
      kind: "system",
      label: "Project Alpha",
      objectType: "Workspace",
      refId: "ws-project-alpha",
      position: projectPos,
      description:
        "Exemplar project workspace. Holds Agents for collaborative work. Chat hangs off Builder, not the workspace root. Live tenant workspaces enrich here when you are signed in.",
      securityNote:
        "Catalog pin only. Workspace rows stay in tenant SQLite files after auth.",
      connectionLabels: ["Workspaces", "Agents"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:agents-project-alpha",
      kind: "system",
      label: "Agents",
      objectType: "Agent",
      refId: "agents-project-alpha",
      position: projectAgentsPos,
      description:
        "Specialized agents for Project Alpha. Build and ship work scoped to this workspace.",
      securityNote: "Agent configs require auth. Graph shows structure only.",
      connectionLabels: ["Project Alpha", "Builder"],
      ctaLabel: "Open Agents",
      cta: { type: "navigate", path: "/agents" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:agent-builder",
      kind: "agent",
      label: "Builder",
      objectType: "Agent",
      refId: "builder",
      position: builderPos,
      description:
        "Exemplar builder agent under Project Alpha. Implements and iterates on project work.",
      securityNote: "No secret values on The Graph.",
      connectionLabels: ["Agents", "Chat"],
      ctaLabel: "Chat with Builder",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: agentChatWindows("builder"),
    },
    agentChatBubble({
      id: "hub:chat-agent-builder",
      agentId: "builder",
      agentLabel: "Builder",
      position: offset(builderPos, 1.5, -0.6, -0.3),
    }),

    {
      id: "hub:ws-family",
      kind: "system",
      label: "Family",
      objectType: "Workspace",
      refId: "ws-family",
      position: familyPos,
      description:
        "Exemplar family workspace. Holds Agents for household coordination. Chat hangs off Coordinator, not the workspace root. Live tenant workspaces enrich here when you are signed in.",
      securityNote:
        "Catalog pin only. Workspace rows stay in tenant SQLite files after auth.",
      connectionLabels: ["Workspaces", "Agents"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:agents-family",
      kind: "system",
      label: "Agents",
      objectType: "Agent",
      refId: "agents-family",
      position: familyAgentsPos,
      description:
        "Specialized agents for the Family workspace. Coordinate shared plans and reminders.",
      securityNote: "Agent configs require auth. Graph shows structure only.",
      connectionLabels: ["Family", "Coordinator"],
      ctaLabel: "Open Agents",
      cta: { type: "navigate", path: "/agents" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:agent-coordinator",
      kind: "agent",
      label: "Coordinator",
      objectType: "Agent",
      refId: "coordinator",
      position: coordinatorPos,
      description:
        "Exemplar coordinator agent under Family. Keeps shared plans and household tasks aligned.",
      securityNote: "No secret values on The Graph.",
      connectionLabels: ["Agents", "Chat"],
      ctaLabel: "Chat with Coordinator",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: agentChatWindows("coordinator"),
    },
    agentChatBubble({
      id: "hub:chat-agent-coordinator",
      agentId: "coordinator",
      agentLabel: "Coordinator",
      position: offset(coordinatorPos, 1.5, 0.5, -0.3),
    }),
  ];
}

function workspaceExemplarEdges(): ArchitectureCatalogEdge[] {
  return [
    {
      id: "e:workspace-personal",
      source: "hub:workspace",
      target: "hub:ws-personal",
      kind: "workspace-child",
    },
    {
      id: "e:workspace-project-alpha",
      source: "hub:workspace",
      target: "hub:ws-project-alpha",
      kind: "workspace-child",
    },
    {
      id: "e:workspace-family",
      source: "hub:workspace",
      target: "hub:ws-family",
      kind: "workspace-child",
    },

    {
      id: "e:personal-structure",
      source: "hub:ws-personal",
      target: "hub:structure-personal",
      kind: "workspace-structure",
    },
    {
      id: "e:structure-personal-departments",
      source: "hub:structure-personal",
      target: "hub:departments-personal",
      kind: "structure-child",
    },

    {
      id: "e:project-alpha-agents",
      source: "hub:ws-project-alpha",
      target: "hub:agents-project-alpha",
      kind: "workspace-agents",
    },
    {
      id: "e:agents-project-builder",
      source: "hub:agents-project-alpha",
      target: "hub:agent-builder",
      kind: "agent-child",
    },
    {
      id: "e:builder-chat",
      source: "hub:agent-builder",
      target: "hub:chat-agent-builder",
      kind: "chat-agent",
    },

    {
      id: "e:family-agents",
      source: "hub:ws-family",
      target: "hub:agents-family",
      kind: "workspace-agents",
    },
    {
      id: "e:agents-family-coordinator",
      source: "hub:agents-family",
      target: "hub:agent-coordinator",
      kind: "agent-child",
    },
    {
      id: "e:coordinator-chat",
      source: "hub:agent-coordinator",
      target: "hub:chat-agent-coordinator",
      kind: "chat-agent",
    },
  ];
}

/**
 * Side trees off Support / Shared / Marketplace (fan upward so Workspaces can
 * keep Personal depth on the right). Expanded by default on first land.
 */
function platformRaySurfaceNodes(): ArchitectureCatalogNode[] {
  const supportPos = { x: 5.0, y: 2.5, z: 0.8 };
  const sharedPos = { x: 6.8, y: 2.5, z: 0.8 };
  const marketPos = { x: 8.6, y: 2.5, z: 0.8 };

  return [
    {
      id: "hub:support-tickets",
      kind: "system",
      label: "Tickets",
      objectType: "Support",
      refId: "support-tickets",
      position: offset(supportPos, -0.2, 1.7, 1.0),
      description:
        "Support tickets: platform bugs and shared-resource issues. Cloud tickets live on the Users hub DB.",
      securityNote: "Ticket bodies stay off The Graph.",
      connectionLabels: ["Support"],
      ctaLabel: "Open Support",
      cta: { type: "open_panel", tab: "support" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:support-chat",
      kind: "system",
      label: "Support Chat",
      objectType: "Support",
      refId: "support-chat",
      position: offset(supportPos, 0.3, 1.7, -1.0),
      description:
        "Chat → Support for help requests. Staffed by the hub Support group when configured.",
      securityNote: "Support chat bodies stay off The Graph.",
      connectionLabels: ["Support"],
      ctaLabel: "Open Support",
      cta: { type: "open_panel", tab: "support" },
      windows: INFO_ONLY,
    },

    {
      id: "hub:shared-grants",
      kind: "system",
      label: "Grants",
      objectType: "SharedSurface",
      refId: "shared-grants",
      position: offset(sharedPos, -0.2, 1.7, 1.0),
      description:
        "Live grants: resources another user shared with you. Access is live, not a static copy.",
      securityNote: "Grant payloads require auth.",
      connectionLabels: ["Shared"],
      ctaLabel: "Open Shared",
      cta: { type: "navigate", path: "/shared" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:shared-network",
      kind: "system",
      label: "Network",
      objectType: "SharedSurface",
      refId: "shared-network",
      position: offset(sharedPos, 0.3, 1.7, -1.0),
      description:
        "Federation and network tooling for cross-home collaboration (including Tailscale panel).",
      securityNote: "Network config requires auth.",
      connectionLabels: ["Shared"],
      ctaLabel: "Open Shared",
      cta: { type: "navigate", path: "/shared" },
      windows: INFO_ONLY,
    },

    {
      id: "hub:marketplace-official",
      kind: "system",
      label: "Official",
      objectType: "Marketplace",
      refId: "marketplace-official",
      position: offset(marketPos, -0.6, 1.6, 1.2),
      description:
        "Curated Official catalog (free and paid). Expand for Packs and Connectors. Default open Marketplace depth on The Graph.",
      securityNote: "Installs require auth. The Graph shows structure only.",
      connectionLabels: ["Marketplace", "Packs", "Connectors"],
      ctaLabel: "Open Marketplace",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-official-packs",
      kind: "system",
      label: "Packs",
      objectType: "Marketplace",
      refId: "marketplace-official-packs",
      position: offset(marketPos, -1.0, 3.0, 1.4),
      description:
        "Official starter packs and curated plugins published by the platform.",
      securityNote: "Installs require auth.",
      connectionLabels: ["Official"],
      ctaLabel: "Open Official",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-official-connectors",
      kind: "system",
      label: "Connectors",
      objectType: "Marketplace",
      refId: "marketplace-official-connectors",
      position: offset(marketPos, 0.2, 3.0, 1.6),
      description:
        "Official account-link and host connectors (quality bar in OFFICIAL_CONNECTORS).",
      securityNote: "Connect flows require auth.",
      connectionLabels: ["Official"],
      ctaLabel: "Open Official",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },

    {
      id: "hub:marketplace-community",
      kind: "system",
      label: "Community",
      objectType: "Marketplace",
      refId: "marketplace-community",
      position: offset(marketPos, 0.8, 1.6, 0.2),
      description:
        "Community listings and user-to-user packs. Sellers keep 90%. The platform takes 10%.",
      securityNote: "Purchases and installs require auth.",
      connectionLabels: ["Marketplace", "Listings", "Sellers"],
      ctaLabel: "Open Community",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-community-listings",
      kind: "system",
      label: "Listings",
      objectType: "Marketplace",
      refId: "marketplace-community-listings",
      position: offset(marketPos, 0.4, 3.0, 0.4),
      description: "Browse and buy Community Marketplace listings.",
      securityNote: "Checkout requires auth.",
      connectionLabels: ["Community"],
      ctaLabel: "Open Community",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-community-sellers",
      kind: "system",
      label: "Sellers",
      objectType: "Marketplace",
      refId: "marketplace-community-sellers",
      position: offset(marketPos, 1.4, 3.0, 0),
      description: "Seller storefronts and publisher identity on Community.",
      securityNote: "Seller profiles require auth.",
      connectionLabels: ["Community"],
      ctaLabel: "Open Community",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },

    {
      id: "hub:marketplace-local",
      kind: "system",
      label: "Local",
      objectType: "Marketplace",
      refId: "marketplace-local",
      position: offset(marketPos, -1.0, 1.5, -0.4),
      description:
        "Local plugin folders and third-party indexes (self-host / desktop). Not arbitrary folders on Cloud.",
      securityNote: "Local installs stay on this machine.",
      connectionLabels: ["Marketplace", "Folders", "Indexes"],
      ctaLabel: "Open Local",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-local-folders",
      kind: "system",
      label: "Folders",
      objectType: "Marketplace",
      refId: "marketplace-local-folders",
      position: offset(marketPos, -1.6, 2.9, -0.2),
      description: "Filesystem plugin folders discovered on this install.",
      securityNote: "Paths stay local.",
      connectionLabels: ["Local"],
      ctaLabel: "Open Local",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-local-indexes",
      kind: "system",
      label: "Indexes",
      objectType: "Marketplace",
      refId: "marketplace-local-indexes",
      position: offset(marketPos, -0.6, 2.9, -0.8),
      description: "Third-party plugin indexes for Local discovery.",
      securityNote: "Index fetches are opt-in.",
      connectionLabels: ["Local"],
      ctaLabel: "Open Local",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },

    {
      id: "hub:marketplace-installed",
      kind: "system",
      label: "Installed",
      objectType: "Marketplace",
      refId: "marketplace-installed",
      position: offset(marketPos, 0.2, 1.5, -1.2),
      description:
        "Workspace plugins and install history for this GodMode instance.",
      securityNote: "Install rows require auth.",
      connectionLabels: ["Marketplace", "Plugins", "History"],
      ctaLabel: "Open Installed",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-installed-plugins",
      kind: "system",
      label: "Plugins",
      objectType: "Marketplace",
      refId: "marketplace-installed-plugins",
      position: offset(marketPos, -0.3, 2.9, -1.4),
      description: "Active plugins installed in the current workspace.",
      securityNote: "Plugin configs require auth.",
      connectionLabels: ["Installed"],
      ctaLabel: "Open Installed",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-installed-history",
      kind: "system",
      label: "History",
      objectType: "Marketplace",
      refId: "marketplace-installed-history",
      position: offset(marketPos, 0.8, 2.9, -1.5),
      description: "Install and uninstall history for Marketplace packs.",
      securityNote: "History rows require auth.",
      connectionLabels: ["Installed"],
      ctaLabel: "Open Installed",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },

    {
      id: "hub:marketplace-sell",
      kind: "system",
      label: "Sell",
      objectType: "Marketplace",
      refId: "marketplace-sell",
      position: offset(marketPos, 1.4, 1.5, -0.6),
      description:
        "Seller dashboard: ToS, payouts, publish wizard, and My listings. Seller seat unlocks Local Sell.",
      securityNote: "Seller commerce requires auth and Cloud authority for paid listings.",
      connectionLabels: ["Marketplace", "My listings", "Payouts"],
      ctaLabel: "Open Sell",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-sell-listings",
      kind: "system",
      label: "My listings",
      objectType: "Marketplace",
      refId: "marketplace-sell-listings",
      position: offset(marketPos, 1.2, 2.9, -0.4),
      description: "Publish and manage your Community listings.",
      securityNote: "Listing drafts require auth.",
      connectionLabels: ["Sell"],
      ctaLabel: "Open Sell",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace-sell-payouts",
      kind: "system",
      label: "Payouts",
      objectType: "Marketplace",
      refId: "marketplace-sell-payouts",
      position: offset(marketPos, 2.0, 2.9, -0.9),
      description: "Seller payouts and Stripe Connect status for Community sales.",
      securityNote: "Payout details never appear on The Graph.",
      connectionLabels: ["Sell"],
      ctaLabel: "Open Sell",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
  ];
}

function platformRaySurfaceEdges(): ArchitectureCatalogEdge[] {
  return [
    {
      id: "e:support-tickets",
      source: "hub:support",
      target: "hub:support-tickets",
      kind: "platform-surface",
    },
    {
      id: "e:support-chat",
      source: "hub:support",
      target: "hub:support-chat",
      kind: "platform-surface",
    },
    {
      id: "e:shared-grants",
      source: "hub:shared",
      target: "hub:shared-grants",
      kind: "platform-surface",
    },
    {
      id: "e:shared-network",
      source: "hub:shared",
      target: "hub:shared-network",
      kind: "platform-surface",
    },
    {
      id: "e:marketplace-official",
      source: "hub:marketplace",
      target: "hub:marketplace-official",
      kind: "platform-surface",
    },
    {
      id: "e:marketplace-official-packs",
      source: "hub:marketplace-official",
      target: "hub:marketplace-official-packs",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-official-connectors",
      source: "hub:marketplace-official",
      target: "hub:marketplace-official-connectors",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-community",
      source: "hub:marketplace",
      target: "hub:marketplace-community",
      kind: "platform-surface",
    },
    {
      id: "e:marketplace-community-listings",
      source: "hub:marketplace-community",
      target: "hub:marketplace-community-listings",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-community-sellers",
      source: "hub:marketplace-community",
      target: "hub:marketplace-community-sellers",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-local",
      source: "hub:marketplace",
      target: "hub:marketplace-local",
      kind: "platform-surface",
    },
    {
      id: "e:marketplace-local-folders",
      source: "hub:marketplace-local",
      target: "hub:marketplace-local-folders",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-local-indexes",
      source: "hub:marketplace-local",
      target: "hub:marketplace-local-indexes",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-installed",
      source: "hub:marketplace",
      target: "hub:marketplace-installed",
      kind: "platform-surface",
    },
    {
      id: "e:marketplace-installed-plugins",
      source: "hub:marketplace-installed",
      target: "hub:marketplace-installed-plugins",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-installed-history",
      source: "hub:marketplace-installed",
      target: "hub:marketplace-installed-history",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-sell",
      source: "hub:marketplace",
      target: "hub:marketplace-sell",
      kind: "platform-surface",
    },
    {
      id: "e:marketplace-sell-listings",
      source: "hub:marketplace-sell",
      target: "hub:marketplace-sell-listings",
      kind: "marketplace-child",
    },
    {
      id: "e:marketplace-sell-payouts",
      source: "hub:marketplace-sell",
      target: "hub:marketplace-sell-payouts",
      kind: "marketplace-child",
    },
  ];
}

/**
 * Living instance map:
 * You (top) and Intelligence (below) meet only at Hub (Bridge). Hub sits
 * on the right with Support → Shared → Marketplace → Workspaces. Each of
 * Support / Shared / Marketplace fans a side tree (expanded by default).
 * Workspaces fans into exemplar Personal / Project / Family trees (one
 * workspace open to full depth). Account, Cloud, and LLM keys live on You's
 * Information panel. Life fans away from each owner.
 */
export function listArchitectureCatalogNodes(): ArchitectureCatalogNode[] {
  // You Life grows upward; Intelligence Life grows downward clear of the hub.
  const youLife = lifeSurfaceNodes("you", { x: 2.8, y: 7.0, z: 0 }, 1);
  const intelLife = lifeSurfaceNodes(
    "intelligence",
    { x: 3.8, y: -0.2, z: 0 },
    -1
  );
  const workspacesPos = { x: 10.4, y: 2.5, z: 0.8 };
  const workspaceTree = workspaceExemplarNodes(workspacesPos);
  const platformSurfaces = platformRaySurfaceNodes();

  return [
    {
      id: "hub:you",
      kind: "user",
      label: "You",
      objectType: "User",
      refId: "local",
      position: { x: 0, y: 5.2, z: 0 },
      description:
        "You are the root of this GodMode instance. Your Vault holds secrets and Bank. Life and personal Chat sit on your plane (Chat to the left). Hub (Bridge) is the only Graph link to Intelligence, and fans out to Support, Shared, Marketplace, and Workspaces. Account, Cloud membership, and LLM keys are part of your identity (see Information), not separate Graph hubs.",
      securityNote:
        "Credentials and LLM key values live in Vault APIs. This node never exposes passwords, tokens, or key material.",
      connectionLabels: [
        "Hub",
        "User Vault",
        "Life",
        "Your Chat",
      ],
      ctaLabel: "Open profile or sign up",
      cta: { type: "open_auth" },
      openImmediate: true,
      windows: [
        { kind: "information", placement: "right", width: 400, height: 520 },
      ],
    },
    {
      id: "hub:intelligence",
      kind: "agent",
      label: "Intelligence",
      objectType: "Agent",
      refId: "intelligence",
      position: { x: 0, y: -0.2, z: 0 },
      description:
        "GodMode's platform agent under You. Owns its Vault, Life surfaces, and Chat. Links to You only through Hub (Bridge). Research and Ops sit nearby on this plane but each link to Hub on their own. Workspace agents like Builder live under Workspaces.",
      securityNote:
        "Runs through Hub with vault-backed credentials. Tool allow-lists bound what it can call.",
      connectionLabels: [
        "Hub",
        "Intelligence Vault",
        "Life",
        "Intelligence Chat",
      ],
      ctaLabel: "Open Intelligence details",
      cta: { type: "none" },
      openImmediate: true,
      windows: INFO_ONLY,
    },
    {
      id: "hub:heart",
      kind: "system",
      label: "Hub",
      objectType: "BridgeConnection",
      refId: "bridge",
      position: { x: 3.2, y: 2.5, z: 0.8 },
      description:
        "The Bridge process between You and Intelligence: HTTP API, kernel ObjectTypes, plugins, and IPC. On The Graph, Hub is the only edge between You and Intelligence, and opens one ray: Support → Shared → Marketplace → Workspaces. Research and Ops each have their own Hub edge. Chat bubbles sit left of each owner. Hub's SQLite holds ops/logs only, not your chat bodies.",
      securityNote:
        "All product mutations go through Bridge auth and tenant middleware. Hub is structural, not a secret store.",
      connectionLabels: ["You", "Intelligence", "Research", "Ops", "Support"],
      ctaLabel: "Learn about Hub",
      cta: { type: "none" },
      windows: INFO_ONLY,
    },

    // --- You plane: Vault = secrets + Bank → Wallet ---
    {
      id: "hub:vault-you",
      kind: "system",
      label: "User Vault",
      objectType: "VaultSecret",
      refId: "vault-user",
      position: { x: -3.2, y: 5.2, z: 0.2 },
      description:
        "Your Vault: encrypted secrets and Bank (with Wallet). LLM key values are stored here when you add providers. Account and Cloud are identity on You, not Vault children.",
      securityNote:
        "The Graph only shows connected / not connected. Secret values never leave Vault APIs.",
      connectionLabels: ["You", "Bank (You)"],
      ctaLabel: "Open Vault",
      cta: { type: "open_panel", tab: "vault" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:bank-you",
      kind: "system",
      label: "Bank",
      objectType: "FinanceConnection",
      refId: "bank-user",
      position: { x: -4.6, y: 5.2, z: -1.0 },
      description:
        "Your finance connections and holdings under User Vault. Wallet sits under Bank.",
      securityNote:
        "No account numbers or balances on the public graph. Open Bank after sign-in for live data.",
      connectionLabels: ["User Vault", "Wallet"],
      ctaLabel: "Open Bank",
      cta: { type: "open_panel", tab: "bank" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:wallet-you",
      kind: "system",
      label: "Wallet",
      objectType: "Wallet",
      refId: "wallet-user",
      position: { x: -6.2, y: 5.2, z: -1.5 },
      description:
        "Your connected wallets under Bank. Manage holdings from Vault → Wallets & Accounts.",
      securityNote: "Addresses and balances stay off The Graph.",
      connectionLabels: ["Bank"],
      ctaLabel: "Open Vault wallets",
      cta: { type: "open_panel", tab: "vault" },
      windows: INFO_ONLY,
    },

    // --- Platform ray right of Hub: Support → Shared → Marketplace → Workspaces ---
    {
      id: "hub:support",
      kind: "system",
      label: "Support",
      objectType: "Support",
      refId: "support",
      position: { x: 5.0, y: 2.5, z: 0.8 },
      description:
        "Help and support on Hub's platform ray. Expanded tree: Tickets and Support Chat.",
      securityNote: "Support tickets and chat stay off The Graph.",
      connectionLabels: ["Hub", "Shared", "Tickets", "Support Chat"],
      ctaLabel: "Open Support",
      cta: { type: "open_panel", tab: "support" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:shared",
      kind: "system",
      label: "Shared",
      objectType: "SharedSurface",
      refId: "shared",
      position: { x: 6.8, y: 2.5, z: 0.8 },
      description:
        "Shared spaces and collaboration on Hub's platform ray. Expanded tree: Grants and Network.",
      securityNote: "Shared content requires auth.",
      connectionLabels: ["Support", "Marketplace", "Grants", "Network"],
      ctaLabel: "Open Shared",
      cta: { type: "navigate", path: "/shared" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:marketplace",
      kind: "system",
      label: "Marketplace",
      objectType: "Marketplace",
      refId: "marketplace",
      position: { x: 8.6, y: 2.5, z: 0.8 },
      description:
        "Discover and install packs on Hub's platform ray. Tabs on the map: Official (default full depth), Community, Local, Installed, and Sell. Only one Marketplace branch is open at a time.",
      securityNote: "Installs require auth. The Graph shows structure only.",
      connectionLabels: [
        "Shared",
        "Workspaces",
        "Official",
        "Community",
        "Local",
        "Installed",
        "Sell",
      ],
      ctaLabel: "Open Marketplace",
      cta: { type: "navigate", path: "/marketplace" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:workspace",
      kind: "system",
      label: "Workspaces",
      objectType: "Workspace",
      refId: "workspace",
      position: workspacesPos,
      description:
        "Workspaces you own. Reached via Hub → Support → Shared → Marketplace. Expand for exemplar Personal, Project Alpha, and Family trees (Agents with Chat off each agent, Structure). Ownership is yours; the ray is how you reach them through Bridge. They may retrieve approved secrets from User Vault (no Vault edge on the map).",
      securityNote:
        "Workspace rows stay in tenant / surface files. This hub is the map pin for the set.",
      connectionLabels: ["Marketplace", "Personal", "Project Alpha", "Family"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },

    ...platformSurfaces,
    ...workspaceTree,

    ...youLife,

    {
      id: "hub:chat-you",
      kind: "chat",
      label: "Digital You",
      objectType: "ChatSession",
      refId: "digital-you",
      position: { x: -1.8, y: 3.8, z: 0 },
      description:
        "Chat with Digital You, your personal twin. Connected to You on The Graph, left of your plane.",
      securityNote: "Message bodies stay in chat DB files.",
      connectionLabels: ["You"],
      ctaLabel: "Chat with Digital You",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: [
        {
          kind: "chat",
          placement: "left",
          width: 560,
          height: 480,
          agentId: "digital-you",
        },
        { kind: "information", placement: "right", width: 400, height: 520 },
      ],
    },

    // --- Intelligence plane: Vault ---
    {
      id: "hub:vault-intelligence",
      kind: "system",
      label: "Intelligence Vault",
      objectType: "VaultSecret",
      refId: "vault-intelligence",
      position: { x: -3.6, y: -0.2, z: 0.2 },
      description:
        "Intelligence's Vault: approved agent secrets and its Bank. Distinct from User Vault.",
      securityNote: "Agent-scoped secrets. Values never appear on The Graph.",
      connectionLabels: ["Intelligence", "Bank (Intelligence)"],
      ctaLabel: "Open Agent Vault",
      cta: { type: "open_panel", tab: "vault" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:bank-intelligence",
      kind: "system",
      label: "Bank",
      objectType: "FinanceConnection",
      refId: "bank-intelligence",
      position: { x: -4.6, y: -0.2, z: -1.0 },
      description:
        "Intelligence finance connections under Intelligence Vault. Wallet sits under Bank.",
      securityNote: "No balances on the public graph.",
      connectionLabels: ["Intelligence Vault", "Wallet"],
      ctaLabel: "Open Bank",
      cta: { type: "open_panel", tab: "bank" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:wallet-intelligence",
      kind: "system",
      label: "Wallet",
      objectType: "Wallet",
      refId: "wallet-intelligence",
      position: { x: -6.2, y: -0.2, z: -1.5 },
      description:
        "Intelligence's connected wallets under its Bank. Agent-scoped holdings.",
      securityNote: "Addresses and balances stay off The Graph.",
      connectionLabels: ["Bank"],
      ctaLabel: "Open Vault wallets",
      cta: { type: "open_panel", tab: "vault" },
      windows: INFO_ONLY,
    },

    ...intelLife,

    ...platformSpineAgentNodes(),

    {
      id: "hub:chat-intelligence",
      kind: "chat",
      label: "Chat",
      objectType: "ChatSession",
      refId: "intelligence",
      position: { x: -1.8, y: 1.2, z: 0 },
      description:
        "Chat with Intelligence, the platform agent. Connected to Intelligence on The Graph, left of its plane.",
      securityNote: "Message bodies stay in chat DB files.",
      connectionLabels: ["Intelligence"],
      ctaLabel: "Chat with Intelligence",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: [
        {
          kind: "chat",
          placement: "left",
          width: 560,
          height: 480,
          agentId: "intelligence",
        },
        { kind: "information", placement: "right", width: 400, height: 520 },
      ],
    },
  ];
}

export function listArchitectureCatalogEdges(): ArchitectureCatalogEdge[] {
  return [
    // You and Intelligence meet only at Hub (Bridge). No direct You↔Intelligence edge.
    { id: "e:you-heart", source: "hub:you", target: "hub:heart", kind: "runtime" },
    { id: "e:intel-heart", source: "hub:intelligence", target: "hub:heart", kind: "runtime" },

    ...platformSpineAgentEdges(),

    { id: "e:you-vault", source: "hub:you", target: "hub:vault-you", kind: "vault" },
    { id: "e:intel-vault", source: "hub:intelligence", target: "hub:vault-intelligence", kind: "vault" },

    // One ray from Hub (not a star plus a chain): Support → Shared → Marketplace → Workspaces.
    { id: "e:heart-support", source: "hub:heart", target: "hub:support", kind: "platform" },
    {
      id: "e:support-shared",
      source: "hub:support",
      target: "hub:shared",
      kind: "platform-chain",
    },
    {
      id: "e:shared-marketplace",
      source: "hub:shared",
      target: "hub:marketplace",
      kind: "platform-chain",
    },
    {
      id: "e:marketplace-workspace",
      source: "hub:marketplace",
      target: "hub:workspace",
      kind: "platform-chain",
    },

    ...workspaceExemplarEdges(),
    ...platformRaySurfaceEdges(),

    { id: "e:vault-you-bank", source: "hub:vault-you", target: "hub:bank-you", kind: "vault-child" },
    {
      id: "e:bank-you-wallet",
      source: "hub:bank-you",
      target: "hub:wallet-you",
      kind: "bank-child",
    },
    {
      id: "e:vault-intel-bank",
      source: "hub:vault-intelligence",
      target: "hub:bank-intelligence",
      kind: "vault-child",
    },
    {
      id: "e:bank-intel-wallet",
      source: "hub:bank-intelligence",
      target: "hub:wallet-intelligence",
      kind: "bank-child",
    },

    ...lifeSurfaceEdges("you"),
    ...lifeSurfaceEdges("intelligence"),

    { id: "e:you-chat", source: "hub:you", target: "hub:chat-you", kind: "chat-user" },
    {
      id: "e:intel-chat",
      source: "hub:intelligence",
      target: "hub:chat-intelligence",
      kind: "chat-agent",
    },
  ];
}

export function getArchitectureCatalogNode(
  id: string
): ArchitectureCatalogNode | undefined {
  return listArchitectureCatalogNodes().find((n) => n.id === id);
}
