/**
 * Versioned GodMode architecture catalog for The Graph (SQLite-universe topology).
 * Public-safe: prose + structure only. No secrets or tenant row dumps.
 * Unlock hubs are intentionally absent.
 *
 * Account, Cloud, and LLM keys are described on You's Information panel (not
 * Graph nodes). Vault is secrets plus Bank (with Wallet). Life fans from each
 * owner. Chat bubbles sit left of the You→Intelligence spine. Heart sits on
 * the right; Support, Shared, Marketplace, and Workspaces extend further right.
 * Specialized agents live under Workspaces (catalog exemplars), not on the spine.
 */

export const ARCHITECTURE_CATALOG_VERSION = 14;

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

type Side = "you" | "intelligence";

function sideLabel(side: Side, noun: string): string {
  return side === "you" ? `Your ${noun}` : `Intelligence ${noun}`;
}

function ownerLabel(side: Side): string {
  return side === "you" ? "You" : "Intelligence";
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
          : "Intelligence's living surfaces: Structure, Knowledge, Automations, and Calendar. Parallel to your Life, owned by the platform agent.",
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
          : "Intelligence's anatomy view: how it grows departments, divisions, and pages.",
      securityNote: `${sideLabel(side, "Structure")} is separate from the other side's Structure.`,
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
      securityNote: "Tool allow-lists bound what Heart will execute.",
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
      securityNote: "Runs under Heart with auth and tool policy.",
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
  const owner = side === "you" ? "hub:you" : "hub:intelligence";
  const p = side === "you" ? "you" : "intel";

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
 * Catalog exemplar workspaces under the Workspaces hub (guest-safe map pins).
 * Personal fans up-right; Project Alpha fans down-right of Workspaces.
 */
function workspaceExemplarNodes(workspacesPos: Vec3): ArchitectureCatalogNode[] {
  const personalPos = offset(workspacesPos, 2.0, 1.8, 0);
  const projectPos = offset(workspacesPos, 2.0, -1.8, 0);

  const personalAgentsPos = offset(personalPos, 2.0, 0.9, 0.2);
  const personalStructurePos = offset(personalPos, 2.0, -0.7, -0.4);
  const personalChatPos = offset(personalPos, 1.2, 1.6, -0.6);

  const projectAgentsPos = offset(projectPos, 2.0, -0.4, 0.2);
  const projectChatPos = offset(projectPos, 1.2, -1.4, -0.4);

  return [
    {
      id: "hub:ws-personal",
      kind: "system",
      label: "Personal",
      objectType: "Workspace",
      refId: "ws-personal",
      position: personalPos,
      description:
        "Exemplar personal workspace. Holds specialized Agents, Structure, and workspace Chat. Live tenant workspaces enrich here when you are signed in.",
      securityNote:
        "Catalog pin only. Workspace rows stay in tenant SQLite files after auth.",
      connectionLabels: ["Workspaces", "Agents", "Structure", "Chat"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:agents-personal",
      kind: "system",
      label: "Agents",
      objectType: "Agent",
      refId: "agents-personal",
      position: personalAgentsPos,
      description:
        "Specialized agents (muscles) for the Personal workspace. Distinct from Intelligence on the spine.",
      securityNote: "Agent configs require auth. Graph shows structure only.",
      connectionLabels: ["Personal", "Research", "Ops"],
      ctaLabel: "Open Agents",
      cta: { type: "navigate", path: "/agents" },
      windows: INFO_ONLY,
    },
    {
      id: "hub:agent-research",
      kind: "agent",
      label: "Research",
      objectType: "Agent",
      refId: "research",
      position: offset(personalAgentsPos, 1.8, 0.8, 0.4),
      description:
        "Exemplar research agent under Personal. Owns a job and executes with a scoped allow-list.",
      securityNote: "No secret values on The Graph.",
      connectionLabels: ["Agents"],
      ctaLabel: "Chat with Research",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: agentChatWindows("research"),
    },
    {
      id: "hub:agent-ops",
      kind: "agent",
      label: "Ops",
      objectType: "Agent",
      refId: "ops",
      position: offset(personalAgentsPos, 1.8, -0.6, -0.3),
      description:
        "Exemplar ops agent under Personal. Handles recurring operational work in this workspace.",
      securityNote: "No secret values on The Graph.",
      connectionLabels: ["Agents"],
      ctaLabel: "Chat with Ops",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: agentChatWindows("ops"),
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
      id: "hub:chat-ws-personal",
      kind: "chat",
      label: "Chat",
      objectType: "ChatSession",
      refId: "ws-personal-chat",
      position: personalChatPos,
      description:
        "Workspace chat for Personal. Thread bodies stay in chat SQLite files.",
      securityNote: "Message bodies stay off The Graph.",
      connectionLabels: ["Personal"],
      ctaLabel: "Open workspace chat",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: [
        { kind: "chat", placement: "left", width: 560, height: 480 },
        { kind: "information", placement: "right", width: 400, height: 520 },
      ],
    },

    {
      id: "hub:ws-project-alpha",
      kind: "system",
      label: "Project Alpha",
      objectType: "Workspace",
      refId: "ws-project-alpha",
      position: projectPos,
      description:
        "Exemplar project workspace. Holds Agents and Chat for collaborative work. Live tenant workspaces enrich here when you are signed in.",
      securityNote:
        "Catalog pin only. Workspace rows stay in tenant SQLite files after auth.",
      connectionLabels: ["Workspaces", "Agents", "Chat"],
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
      position: offset(projectAgentsPos, 1.8, -0.5, 0.3),
      description:
        "Exemplar builder agent under Project Alpha. Implements and iterates on project work.",
      securityNote: "No secret values on The Graph.",
      connectionLabels: ["Agents"],
      ctaLabel: "Chat with Builder",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: agentChatWindows("builder"),
    },
    {
      id: "hub:chat-ws-project-alpha",
      kind: "chat",
      label: "Chat",
      objectType: "ChatSession",
      refId: "ws-project-alpha-chat",
      position: projectChatPos,
      description:
        "Workspace chat for Project Alpha. Thread bodies stay in chat SQLite files.",
      securityNote: "Message bodies stay off The Graph.",
      connectionLabels: ["Project Alpha"],
      ctaLabel: "Open workspace chat",
      cta: { type: "open_chat" },
      openImmediate: true,
      windows: [
        { kind: "chat", placement: "left", width: 560, height: 480 },
        { kind: "information", placement: "right", width: 400, height: 520 },
      ],
    },
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
      id: "e:personal-agents",
      source: "hub:ws-personal",
      target: "hub:agents-personal",
      kind: "workspace-agents",
    },
    {
      id: "e:personal-structure",
      source: "hub:ws-personal",
      target: "hub:structure-personal",
      kind: "workspace-structure",
    },
    {
      id: "e:personal-chat",
      source: "hub:ws-personal",
      target: "hub:chat-ws-personal",
      kind: "workspace-chat",
    },
    {
      id: "e:agents-personal-research",
      source: "hub:agents-personal",
      target: "hub:agent-research",
      kind: "agent-child",
    },
    {
      id: "e:agents-personal-ops",
      source: "hub:agents-personal",
      target: "hub:agent-ops",
      kind: "agent-child",
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
      id: "e:project-alpha-chat",
      source: "hub:ws-project-alpha",
      target: "hub:chat-ws-project-alpha",
      kind: "workspace-chat",
    },
    {
      id: "e:agents-project-builder",
      source: "hub:agents-project-alpha",
      target: "hub:agent-builder",
      kind: "agent-child",
    },
  ];
}

/**
 * Living instance map:
 * You (top) ↔ Intelligence (below). Heart sits on the right with
 * Support → Shared → Marketplace → Workspaces. Workspaces fan into exemplar
 * Personal / Project trees (Agents, Structure, Chat). Account, Cloud, and LLM
 * keys live on You's Information panel. Life fans away from each owner.
 */
export function listArchitectureCatalogNodes(): ArchitectureCatalogNode[] {
  // You Life grows upward; Intelligence Life grows downward clear of the hub.
  const youLife = lifeSurfaceNodes("you", { x: 2.8, y: 7.0, z: 0 }, 1);
  const intelLife = lifeSurfaceNodes(
    "intelligence",
    { x: 2.8, y: -2.2, z: 0 },
    -1
  );
  const workspacesPos = { x: 10.4, y: 2.5, z: 0.8 };
  const workspaceTree = workspaceExemplarNodes(workspacesPos);

  return [
    {
      id: "hub:you",
      kind: "user",
      label: "You",
      objectType: "User",
      refId: "local",
      position: { x: 0, y: 5.2, z: 0 },
      description:
        "You are the root of this GodMode instance. Your Vault holds secrets and Bank. Life and personal Chat sit on your plane (Chat left of the spine to Intelligence). Heart (Bridge) sits on the right and fans out to Support, Shared, Marketplace, and Workspaces. Account, Cloud membership, and LLM keys are part of your identity (see Information), not separate Graph hubs.",
      securityNote:
        "Credentials and LLM key values live in Vault APIs. This node never exposes passwords, tokens, or key material.",
      connectionLabels: [
        "Intelligence",
        "Heart",
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
        "GodMode's platform agent under You. Owns its Vault, Life surfaces, and Chat. Links through Heart (Bridge). Specialized agents live under Workspaces on The Graph, not as spine hubs.",
      securityNote:
        "Runs through Heart with vault-backed credentials. Tool allow-lists bound what it can call.",
      connectionLabels: [
        "You",
        "Heart",
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
      label: "Heart",
      objectType: "BridgeConnection",
      refId: "bridge",
      position: { x: 3.2, y: 2.5, z: 0.8 },
      description:
        "The Bridge process between You and Intelligence: HTTP API, kernel ObjectTypes, plugins, and IPC. On The Graph, Heart sits right of the spine and opens one ray: Support → Shared → Marketplace → Workspaces. Chat bubbles sit left of You→Intelligence. Heart's SQLite holds ops/logs only, not your chat bodies.",
      securityNote:
        "All product mutations go through Bridge auth and tenant middleware. Heart is structural, not a secret store.",
      connectionLabels: ["You", "Intelligence", "Support"],
      ctaLabel: "Learn about Heart",
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

    // --- Platform ray right of Heart: Support → Shared → Marketplace → Workspaces ---
    {
      id: "hub:support",
      kind: "system",
      label: "Support",
      objectType: "Support",
      refId: "support",
      position: { x: 5.0, y: 2.5, z: 0.8 },
      description: "Help and support surfaces on Heart's platform ray.",
      securityNote: "Support tickets and chat stay off The Graph.",
      connectionLabels: ["Heart", "Shared"],
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
      description: "Shared spaces and collaborations on Heart's platform ray.",
      securityNote: "Shared content requires auth.",
      connectionLabels: ["Support", "Marketplace"],
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
      description: "Discover and install marketplace offerings on Heart's platform ray.",
      securityNote: "Installs require auth. The Graph shows structure only.",
      connectionLabels: ["Shared", "Workspaces"],
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
        "Workspaces you own. Reached via Heart → Support → Shared → Marketplace. Expand for exemplar Personal and Project Alpha trees (Agents, Structure, Chat). Ownership is yours; the ray is how you reach them through Bridge. They may retrieve approved secrets from User Vault (no Vault edge on the map).",
      securityNote:
        "Workspace rows stay in tenant / surface files. This hub is the map pin for the set.",
      connectionLabels: ["Marketplace", "Personal", "Project Alpha"],
      ctaLabel: "Open Structure",
      cta: { type: "navigate", path: "/structure" },
      windows: INFO_ONLY,
    },

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
        "Chat with Digital You, your personal twin. Connected to You on The Graph, left of the You→Intelligence spine.",
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

    {
      id: "hub:chat-intelligence",
      kind: "chat",
      label: "Chat",
      objectType: "ChatSession",
      refId: "intelligence",
      position: { x: -1.8, y: 1.2, z: 0 },
      description:
        "Chat with Intelligence, the platform agent. Connected to Intelligence on The Graph, left of the You→Intelligence spine.",
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
    // Spine: You ↔ Intelligence, both meet Heart (Bridge). No Chat→Heart doubles.
    { id: "e:you-intel", source: "hub:you", target: "hub:intelligence", kind: "agent-user" },
    { id: "e:you-heart", source: "hub:you", target: "hub:heart", kind: "runtime" },
    { id: "e:intel-heart", source: "hub:intelligence", target: "hub:heart", kind: "runtime" },

    { id: "e:you-vault", source: "hub:you", target: "hub:vault-you", kind: "vault" },
    { id: "e:intel-vault", source: "hub:intelligence", target: "hub:vault-intelligence", kind: "vault" },

    // One ray from Heart (not a star plus a chain): Support → Shared → Marketplace → Workspaces.
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
