/**
 * GraphProjection: ObjectType neighborhood + architecture map for The Graph.
 */
import type { AppDatabase } from "../db.js";
import { getCloudDb, type CoreDatabase } from "../core-db.js";
import { addCol, columnExists, tableExists } from "./db-migrations.js";
import { getChatGraphDoc } from "./chat-unlock.js";
import {
  ARCHITECTURE_CATALOG_VERSION,
  listArchitectureCatalogEdges,
  listArchitectureCatalogNodes,
  type GraphCtaAction,
  type GraphWindowSpec,
} from "./graph-architecture-catalog.js";
import {
  attentionStatusForNode,
  getGraphMissionsStatus,
} from "./graph-missions.js";

export type { GraphWindowSpec };

export type GraphNodeKind =
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

export type GraphProjectionNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  objectType?: string;
  refId?: string;
  position?: { x: number; y: number; z?: number };
  description?: string;
  securityNote?: string;
  connectionLabels?: string[];
  ctaLabel?: string;
  cta?: GraphCtaAction;
  openImmediate?: boolean;
  windows?: GraphWindowSpec[];
  /** Safe status flags only (e.g. entitled, connected, attention). */
  status?: Record<string, boolean | string | number>;
};

export type GraphProjectionEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
};

export type GraphProjection = {
  focusType: string;
  focusId: string;
  nodes: GraphProjectionNode[];
  edges: GraphProjectionEdge[];
  truncated: boolean;
  catalogVersion?: number;
};

const MAX_NODES = 160;
const MAX_EDGES = 150;
const MEM_LIMIT = 12;
const SKILL_LIMIT = 8;
const TOOL_LIMIT = 12;
const WORKFLOW_LIMIT = 6;

/** Ensure ai_chats.agent_id exists (self-heal tenants that skipped migrate). */
function ensureAiChatsAgentId(db: AppDatabase): boolean {
  try {
    if (!tableExists(db, "ai_chats")) return false;
    if (columnExists(db, "ai_chats", "agent_id")) return true;
    addCol(db, "ai_chats", "agent_id", "TEXT");
    return columnExists(db, "ai_chats", "agent_id");
  } catch {
    return false;
  }
}

function pushNode(
  nodes: GraphProjectionNode[],
  seen: Set<string>,
  node: GraphProjectionNode
): boolean {
  if (seen.has(node.id) || nodes.length >= MAX_NODES) return false;
  seen.add(node.id);
  nodes.push(node);
  return true;
}

function pushEdge(
  edges: GraphProjectionEdge[],
  seen: Set<string>,
  edge: GraphProjectionEdge
): boolean {
  if (seen.has(edge.id) || edges.length >= MAX_EDGES) return false;
  seen.add(edge.id);
  edges.push(edge);
  return true;
}

function parseToolAllow(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parseToolAllow(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function buildGraphProjection(opts: {
  tenantDb: AppDatabase;
  focusType: "chat" | "agent" | "user";
  focusId: string;
  userId: string;
  userLabel?: string;
  cloudDb?: CoreDatabase;
}): GraphProjection {
  const nodes: GraphProjectionNode[] = [];
  const edges: GraphProjectionEdge[] = [];
  const seenN = new Set<string>();
  const seenE = new Set<string>();
  const db = opts.tenantDb;
  const cloud = opts.cloudDb ?? getCloudDb();

  let chatId =
    opts.focusType === "chat" ? opts.focusId : "";
  let agentId =
    opts.focusType === "agent" ? opts.focusId : "intelligence";

  const chatHasAgentId = ensureAiChatsAgentId(db);

  if (opts.focusType === "chat") {
    const chat = chatHasAgentId
      ? (db
          .prepare(
            `SELECT id, title, agent_id FROM ai_chats WHERE id = ? LIMIT 1`
          )
          .get(chatId) as
          | { id: string; title: string; agent_id: string | null }
          | undefined)
      : (db
          .prepare(`SELECT id, title FROM ai_chats WHERE id = ? LIMIT 1`)
          .get(chatId) as { id: string; title: string } | undefined);
    if (chat) {
      agentId = chatHasAgentId
        ? (((chat as { agent_id?: string | null }).agent_id ?? "intelligence")
            .trim() || "intelligence")
        : "intelligence";
      pushNode(nodes, seenN, {
        id: `chat:${chat.id}`,
        kind: "chat",
        label: chat.title || "Chat",
        objectType: "ChatSession",
        refId: chat.id,
        position: { x: 0, y: 0, z: 0 },
      });
    } else {
      pushNode(nodes, seenN, {
        id: `chat:${chatId}`,
        kind: "chat",
        label: "Chat",
        objectType: "ChatSession",
        refId: chatId,
        position: { x: 0, y: 0, z: 0 },
      });
    }
  }

  if (opts.focusType === "user") {
    pushNode(nodes, seenN, {
      id: `user:${opts.userId}`,
      kind: "user",
      label: opts.userLabel?.trim() || "You",
      objectType: "User",
      refId: opts.userId,
      position: { x: 0, y: 2.5, z: 0 },
    });
  }

  // Always include the current user in the triad for first reveal.
  pushNode(nodes, seenN, {
    id: `user:${opts.userId}`,
    kind: "user",
    label: opts.userLabel?.trim() || "You",
    objectType: "User",
    refId: opts.userId,
    position: { x: 0, y: 2.5, z: 0 },
  });

  const agent = db
    .prepare(`SELECT id, name FROM ai_agents WHERE id = ? LIMIT 1`)
    .get(agentId) as { id: string; name: string } | undefined;
  const agentLabel = agent?.name ?? (agentId === "intelligence" ? "Intelligence" : agentId);
  pushNode(nodes, seenN, {
    id: `agent:${agentId}`,
    kind: "agent",
    label: agentLabel,
    objectType: "Agent",
    refId: agentId,
    position: { x: 0, y: 1.2, z: 0 },
  });

  if (chatId) {
    pushEdge(edges, seenE, {
      id: `edge:chat-agent:${chatId}:${agentId}`,
      source: `chat:${chatId}`,
      target: `agent:${agentId}`,
      kind: "chat-agent",
    });
  }
  pushEdge(edges, seenE, {
    id: `edge:agent-user:${agentId}:${opts.userId}`,
    source: `agent:${agentId}`,
    target: `user:${opts.userId}`,
    kind: "agent-user",
  });
  if (chatId) {
    pushEdge(edges, seenE, {
      id: `edge:chat-user:${chatId}:${opts.userId}`,
      source: `chat:${chatId}`,
      target: `user:${opts.userId}`,
      kind: "chat-user",
    });
  }

  // Docked sibling chats from unlock graph layout.
  try {
    const doc = getChatGraphDoc(opts.userId, cloud);
    let i = 0;
    for (const n of doc.nodes) {
      if (nodes.length >= MAX_NODES) break;
      const id = `chat:${n.chatId}`;
      if (pushNode(nodes, seenN, {
        id,
        kind: "chat",
        label: n.label || "Chat",
        objectType: "ChatSession",
        refId: n.chatId,
        position: {
          x: n.position.x / 120,
          y: 0,
          z: n.position.y / 120,
        },
      })) {
        if (chatId && n.chatId !== chatId) {
          pushEdge(edges, seenE, {
            id: `edge:chat-chat:${chatId}:${n.chatId}`,
            source: `chat:${chatId}`,
            target: id,
            kind: "chat-chat",
          });
        }
        // Ensure agent link for docked chats when known.
        const row = chatHasAgentId
          ? (db
              .prepare(`SELECT agent_id FROM ai_chats WHERE id = ?`)
              .get(n.chatId) as { agent_id: string | null } | undefined)
          : undefined;
        const aid = chatHasAgentId
          ? ((row?.agent_id ?? "intelligence").trim() || "intelligence")
          : "intelligence";
        pushNode(nodes, seenN, {
          id: `agent:${aid}`,
          kind: "agent",
          label: aid === "intelligence" ? "Intelligence" : aid,
          objectType: "Agent",
          refId: aid,
        });
        pushEdge(edges, seenE, {
          id: `edge:chat-agent:${n.chatId}:${aid}`,
          source: id,
          target: `agent:${aid}`,
          kind: "chat-agent",
        });
      }
      i += 1;
      if (i > 20) break;
    }
  } catch {
    /* cloud graph optional for visitors */
  }

  if (chatId) {
    const memories = db
      .prepare(
        `SELECT id, text FROM ai_memories
         WHERE chat_id = ? OR (agent_id = ? AND (chat_id IS NULL OR chat_id = ''))
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(chatId, agentId, MEM_LIMIT) as Array<{ id: string; text: string }>;
    let mi = 0;
    for (const m of memories) {
      const nid = `memory:${m.id}`;
      if (
        pushNode(nodes, seenN, {
          id: nid,
          kind: "memory",
          label: (m.text || "Memory").slice(0, 48),
          objectType: "Memory",
          refId: m.id,
          position: { x: 1.4 + (mi % 3) * 0.4, y: 0.4, z: Math.floor(mi / 3) * 0.4 },
        })
      ) {
        pushEdge(edges, seenE, {
          id: `edge:chat-memory:${chatId}:${m.id}`,
          source: `chat:${chatId}`,
          target: nid,
          kind: "chat-memory",
        });
        pushEdge(edges, seenE, {
          id: `edge:agent-memory:${agentId}:${m.id}`,
          source: `agent:${agentId}`,
          target: nid,
          kind: "agent-memory",
        });
      }
      mi += 1;
    }
  }

  // Skills linked to agent (state table; label = skill_id)
  try {
    const skills = db
      .prepare(
        `SELECT skill_id AS id FROM ai_agent_skill_state
         WHERE agent_id = ? AND enabled = 1
         LIMIT ?`
      )
      .all(agentId, SKILL_LIMIT) as Array<{ id: string }>;
    let si = 0;
    for (const s of skills) {
      const nid = `skill:${s.id}`;
      if (
        pushNode(nodes, seenN, {
          id: nid,
          kind: "skill",
          label: s.id,
          objectType: "Skill",
          refId: s.id,
          position: { x: -1.4 - (si % 3) * 0.35, y: 0.6, z: Math.floor(si / 3) * 0.35 },
        })
      ) {
        pushEdge(edges, seenE, {
          id: `edge:agent-skill:${agentId}:${s.id}`,
          source: `agent:${agentId}`,
          target: nid,
          kind: "agent-skill",
        });
      }
      si += 1;
    }
  } catch {
    /* skills optional */
  }

  // Tools from agent tool_allow_json
  try {
    const agentRow = db
      .prepare(`SELECT tool_allow_json FROM ai_agents WHERE id = ?`)
      .get(agentId) as { tool_allow_json: string | null } | undefined;
    const tools = parseToolAllow(agentRow?.tool_allow_json).slice(0, TOOL_LIMIT);
    let ti = 0;
    for (const tool of tools) {
      const nid = `tool:${tool}`;
      if (
        pushNode(nodes, seenN, {
          id: nid,
          kind: "tool",
          label: tool,
          refId: tool,
          position: { x: -0.8 + (ti % 4) * 0.35, y: -0.8, z: Math.floor(ti / 4) * 0.35 },
        })
      ) {
        pushEdge(edges, seenE, {
          id: `edge:agent-tool:${agentId}:${tool}`,
          source: `agent:${agentId}`,
          target: nid,
          kind: "agent-tool",
        });
      }
      ti += 1;
    }
  } catch {
    /* optional */
  }

  // Workflows
  try {
    const workflows = db
      .prepare(
        `SELECT id, name FROM ai_workflows WHERE agent_id = ? LIMIT ?`
      )
      .all(agentId, WORKFLOW_LIMIT) as Array<{ id: string; name: string }>;
    let wi = 0;
    for (const w of workflows) {
      const nid = `workflow:${w.id}`;
      if (
        pushNode(nodes, seenN, {
          id: nid,
          kind: "workflow",
          label: w.name || w.id,
          objectType: "Workflow",
          refId: w.id,
          position: { x: 1.2 + (wi % 3) * 0.4, y: -0.6, z: Math.floor(wi / 3) * 0.4 },
        })
      ) {
        pushEdge(edges, seenE, {
          id: `edge:agent-workflow:${agentId}:${w.id}`,
          source: `agent:${agentId}`,
          target: nid,
          kind: "agent-workflow",
        });
      }
      wi += 1;
    }
  } catch {
    /* optional */
  }

  const truncated = nodes.length >= MAX_NODES || edges.length >= MAX_EDGES;
  return {
    focusType: opts.focusType,
    focusId: opts.focusId,
    nodes,
    edges,
    truncated,
  };
}

function tableHasRows(db: AppDatabase, table: string): boolean {
  try {
    if (!tableExists(db, table)) return false;
    const row = db.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).get() as
      | { ok: number }
      | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

function secretKeyHints(db: AppDatabase): Set<string> {
  const keys = new Set<string>();
  try {
    if (!tableExists(db, "vault_secrets")) return keys;
    // Names / ids only, never secret values.
    const cols = db.prepare(`PRAGMA table_info(vault_secrets)`).all() as Array<{
      name: string;
    }>;
    const nameCol = cols.some((c) => c.name === "name")
      ? "name"
      : cols.some((c) => c.name === "key")
        ? "key"
        : cols.some((c) => c.name === "id")
          ? "id"
          : null;
    if (!nameCol) return keys;
    const rows = db
      .prepare(`SELECT ${nameCol} AS k FROM vault_secrets LIMIT 40`)
      .all() as Array<{ k: string }>;
    for (const r of rows) {
      if (typeof r.k === "string" && r.k.trim()) keys.add(r.k.toLowerCase());
    }
  } catch {
    /* optional */
  }
  return keys;
}

function slotConnected(hints: Set<string>, needles: string[]): boolean {
  for (const h of hints) {
    for (const n of needles) {
      if (h.includes(n)) return true;
    }
  }
  return false;
}

/** Caps for live instances on the architecture map (keep catalog readable). */
const LIVE_ARCH_CAPS: Partial<Record<GraphNodeKind, number>> = {
  chat: 16, // total across parents; per-parent cap is LIVE_CHAT_PER_PARENT
  workflow: 4,
  page: 6,
  skill: 4,
  tool: 4,
  schedule: 4,
};

/** Max live chats hung under a single Chat bubble. */
const LIVE_CHAT_PER_PARENT = 4;

type Vec3 = { x: number; y: number; z?: number };

function catalogAnchor(
  nodes: GraphProjectionNode[],
  id: string,
  fallback: Vec3
): Vec3 {
  const n = nodes.find((x) => x.id === id);
  return n?.position ? { ...n.position } : fallback;
}

/**
 * Chat bubble (or agent hub) that should own a live chat on the architecture map.
 * Digital You / empty → hub:chat-you; platform agents → their chat hubs.
 */
export function chatParentHubId(
  agentId: string | null | undefined,
  catalogNodeIds: Set<string>
): string {
  const raw = (agentId ?? "").trim().toLowerCase();
  const aid =
    !raw || raw === "user" || raw === "digital-you" || raw === "you"
      ? "digital-you"
      : raw;

  const byAgent: Record<string, string> = {
    "digital-you": "hub:chat-you",
    intelligence: "hub:chat-intelligence",
    research: "hub:chat-agent-research",
    ops: "hub:chat-agent-ops",
    builder: "hub:chat-agent-builder",
    coordinator: "hub:chat-agent-coordinator",
  };

  const preferred = byAgent[aid] ?? `hub:chat-agent-${aid}`;
  if (catalogNodeIds.has(preferred)) return preferred;

  const agentHub = `hub:agent-${aid}`;
  if (aid !== "digital-you" && catalogNodeIds.has(agentHub)) return agentHub;

  if (catalogNodeIds.has("hub:chat-you")) return "hub:chat-you";
  return "hub:chat-intelligence";
}

/** Parent hub + bay direction for each live kind on the architecture map. */
function liveArchPlacement(kind: GraphNodeKind): {
  parentId: string;
  /** Unit direction from parent into the live bay (catalog space). */
  dir: Vec3;
} {
  switch (kind) {
    case "chat":
      return {
        parentId: "hub:chat-intelligence",
        dir: { x: -1, y: -0.35, z: 0.15 },
      };
    case "workflow":
      return {
        parentId: "hub:automations-intelligence",
        dir: { x: -0.9, y: -0.5, z: -0.2 },
      };
    case "page":
      return {
        parentId: "hub:knowledge-intelligence",
        dir: { x: 0.85, y: -0.55, z: -0.25 },
      };
    case "schedule":
      return {
        parentId: "hub:calendar-intelligence",
        dir: { x: -0.7, y: -0.55, z: 0.35 },
      };
    case "skill":
    case "tool":
      return {
        parentId: "hub:intelligence",
        dir: { x: -1.1, y: 0.2, z: 0.55 },
      };
    default:
      return {
        parentId: "hub:intelligence",
        dir: { x: -0.9, y: -0.4, z: 0.4 },
      };
  }
}

function liveBayPosition(anchor: Vec3, dir: Vec3, index: number): Vec3 {
  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const along = 1.15 + row * 0.85;
  const side = (col - 1) * 0.7;
  // Perpendicular in XY for a small grid beside the ray.
  const px = -dir.y;
  const py = dir.x;
  return {
    x: anchor.x + dir.x * along + px * side,
    y: anchor.y + dir.y * along + py * side,
    z: (anchor.z ?? 0) + (dir.z ?? 0) * along + (col - 1) * 0.2,
  };
}

function mergeLiveNeighborhoodIntoArchitecture(opts: {
  nodes: GraphProjectionNode[];
  edges: GraphProjectionEdge[];
  seenN: Set<string>;
  seenE: Set<string>;
  tenantDb: AppDatabase;
  userId: string;
  userLabel?: string;
  cloudDb?: CoreDatabase;
}): void {
  const db = opts.tenantDb;
  ensureAiChatsAgentId(db);

  const catalogIds = new Set(opts.nodes.map((n) => n.id));
  const chatDir = liveArchPlacement("chat").dir;
  const FALLBACK: Vec3 = { x: -2, y: 2, z: 0 };

  let focusChatId = "session-local";
  const recentChats: Array<{
    id: string;
    title: string | null;
    agentId: string | null;
  }> = [];
  try {
    if (tableExists(db, "ai_chats")) {
      const hasAgent = columnExists(db, "ai_chats", "agent_id");
      const rows = hasAgent
        ? (db
            .prepare(
              `SELECT id, title, agent_id AS agentId FROM ai_chats
               ORDER BY updated_at DESC
               LIMIT ?`
            )
            .all(24) as Array<{
            id: string;
            title: string | null;
            agentId: string | null;
          }>)
        : (
            db
              .prepare(
                `SELECT id, title FROM ai_chats
                 ORDER BY updated_at DESC
                 LIMIT ?`
              )
              .all(24) as Array<{ id: string; title: string | null }>
          ).map((r) => ({ ...r, agentId: "intelligence" as string | null }));
      for (const r of rows) {
        if (r.id && r.id !== "session-local") {
          recentChats.push({
            id: r.id,
            title: r.title,
            agentId: r.agentId,
          });
        }
      }
      if (recentChats[0]) focusChatId = recentChats[0].id;
    }
  } catch {
    /* optional */
  }

  const live = buildGraphProjection({
    tenantDb: db,
    focusType: focusChatId !== "session-local" ? "chat" : "agent",
    focusId: focusChatId !== "session-local" ? focusChatId : "intelligence",
    userId: opts.userId,
    userLabel: opts.userLabel,
    cloudDb: opts.cloudDb,
  });

  // Live chats: place under the owning agent's Chat bubble (Phase A / #789).
  const chatsPerParent = new Map<string, number>();
  let chatTotal = 0;
  const chatCapTotal = LIVE_ARCH_CAPS.chat ?? 16;

  for (const c of recentChats) {
    if (chatTotal >= chatCapTotal) break;
    const parentId = chatParentHubId(c.agentId, catalogIds);
    const used = chatsPerParent.get(parentId) ?? 0;
    if (used >= LIVE_CHAT_PER_PARENT) continue;

    const anchor = catalogAnchor(opts.nodes, parentId, FALLBACK);
    const position = liveBayPosition(anchor, chatDir, used);
    const nid = `chat:${c.id}`;

    if (
      !pushNode(opts.nodes, opts.seenN, {
        id: nid,
        kind: "chat",
        label: (c.title || "Chat").slice(0, 48),
        objectType: "ChatSession",
        refId: c.id,
        position,
        description: undefined,
        securityNote: "Live workspace chat. Open Chat for message bodies.",
        connectionLabels: [parentId.replace(/^hub:/, "")],
        ctaLabel: "Open chat",
        cta: { type: "open_chat" },
        openImmediate: true,
        status: {
          liveInstance: true,
          ownerAgent: (c.agentId ?? "digital-you").trim() || "digital-you",
        },
      })
    ) {
      continue;
    }

    pushEdge(opts.edges, opts.seenE, {
      id: `edge:live:${parentId}:${nid}`,
      source: parentId,
      target: nid,
      kind: "live-instance",
    });
    chatsPerParent.set(parentId, used + 1);
    chatTotal += 1;
  }

  // Non-chat live kinds (workflows, pages, …) keep Intelligence-side bays for now.
  const candidates: GraphProjectionNode[] = [];
  for (const n of live.nodes) {
    if (n.kind === "memory" || n.kind === "user" || n.kind === "agent") continue;
    if (n.kind === "chat") continue;
    if (n.kind === "tool" || n.kind === "skill") continue;
    if (candidates.some((c) => c.id === n.id)) continue;
    candidates.push(n);
  }

  const counts: Partial<Record<GraphNodeKind, number>> = {};

  for (const n of candidates) {
    const cap = LIVE_ARCH_CAPS[n.kind] ?? 3;
    const used = counts[n.kind] ?? 0;
    if (used >= cap) continue;

    const place = liveArchPlacement(n.kind);
    const anchor = catalogAnchor(opts.nodes, place.parentId, FALLBACK);
    const position = liveBayPosition(anchor, place.dir, used);

    if (
      !pushNode(opts.nodes, opts.seenN, {
        ...n,
        position,
        description: undefined,
        securityNote:
          "Live workspace instance. Open Chat or Knowledge for contents.",
        connectionLabels: [place.parentId.replace(/^hub:/, "")],
        ctaLabel:
          n.kind === "workflow"
            ? "Open Automations"
            : n.kind === "schedule"
              ? "Open Calendar"
              : n.kind === "page"
                ? "Open Knowledge"
                : "Open",
        cta:
          n.kind === "workflow"
            ? { type: "open_panel", tab: "projects" }
            : n.kind === "schedule"
              ? { type: "open_panel", tab: "calendar" }
              : n.kind === "page"
                ? { type: "open_panel", tab: "knowledge" }
                : { type: "none" },
        openImmediate: false,
        status: { ...(n.status ?? {}), liveInstance: true },
      })
    ) {
      continue;
    }

    pushEdge(opts.edges, opts.seenE, {
      id: `edge:live:${place.parentId}:${n.id}`,
      source: place.parentId,
      target: n.id,
      kind: "live-instance",
    });
    counts[n.kind] = used + 1;
  }

  pushPlatformAgentToolSummaries({
    nodes: opts.nodes,
    edges: opts.edges,
    seenN: opts.seenN,
    seenE: opts.seenE,
    tenantDb: db,
  });
}

/** Tools hang off Hub (Bridge): runtime that executes allowlisted tools. */
function pushPlatformAgentToolSummaries(opts: {
  nodes: GraphProjectionNode[];
  edges: GraphProjectionEdge[];
  seenN: Set<string>;
  seenE: Set<string>;
  tenantDb: AppDatabase;
}): void {
  if (!tableExists(opts.tenantDb, "ai_agents")) return;

  const hubId = "hub:heart";
  if (!opts.nodes.some((n) => n.id === hubId)) return;

  const agents: Array<{ agentId: string; label: string }> = [
    { agentId: "intelligence", label: "Intelligence" },
    { agentId: "research", label: "Research" },
    { agentId: "ops", label: "Ops" },
  ];

  const FALLBACK: Vec3 = { x: 3.2, y: 2.5, z: 0.8 };
  const hubAnchor = catalogAnchor(opts.nodes, hubId, FALLBACK);
  // Bay below/along Hub's platform ray so tools read as Bridge-owned.
  const dir: Vec3 = { x: 0.35, y: -1, z: 0.2 };
  let bayIndex = 0;

  for (const a of agents) {
    let tools: string[] = [];
    try {
      const row = opts.tenantDb
        .prepare(`SELECT tool_allow_json FROM ai_agents WHERE id = ?`)
        .get(a.agentId) as { tool_allow_json: string | null } | undefined;
      tools = parseToolAllow(row?.tool_allow_json);
    } catch {
      continue;
    }
    if (tools.length === 0) continue;

    const position = liveBayPosition(hubAnchor, dir, bayIndex);
    bayIndex += 1;

    const nid = `live:tools:${a.agentId}`;
    if (
      !pushNode(opts.nodes, opts.seenN, {
        id: nid,
        kind: "tool",
        label: `${a.label} tools (${tools.length})`,
        objectType: "ToolDefinition",
        refId: a.agentId,
        position,
        description: `${a.label} tool allowlist (${tools.length}). Hub (Bridge) owns execution; agents inherit grants.`,
        securityNote:
          "Architecture map shows counts on Hub. Tool names stay on agent / Chat Information panels.",
        connectionLabels: ["Hub", a.label],
        ctaLabel: "Inspect Hub",
        cta: { type: "none" },
        status: {
          liveInstance: true,
          toolCount: tools.length,
          ownerAgent: a.agentId,
          toolPreview: tools.slice(0, 8).join(", "),
        },
      })
    ) {
      continue;
    }

    pushEdge(opts.edges, opts.seenE, {
      id: `edge:live:tools:${a.agentId}`,
      source: hubId,
      target: nid,
      kind: "live-instance",
    });
  }
}

/**
 * Public-safe GodMode architecture map. Optional auth enrichment adds
 * entitlement / vault-connected booleans and a capped live chat neighborhood
 * (no message or memory bodies for anonymous; neighborhood only when tenantDb).
 */
export function buildArchitectureProjection(opts: {
  userId?: string;
  userLabel?: string;
  tenantDb?: AppDatabase | null;
  cloudDb?: CoreDatabase;
  enrichLiveNeighborhood?: boolean;
}): GraphProjection {
  const nodes: GraphProjectionNode[] = [];
  const edges: GraphProjectionEdge[] = [];
  const seenN = new Set<string>();
  const seenE = new Set<string>();

  const vaultHints = opts.tenantDb
    ? secretKeyHints(opts.tenantDb)
    : new Set<string>();
  const vaultAny = opts.tenantDb
    ? tableHasRows(opts.tenantDb, "vault_secrets")
    : false;

  const missionStatus = getGraphMissionsStatus({
    userId: opts.userId,
    tenantDb: opts.tenantDb ?? null,
  });

  for (const n of listArchitectureCatalogNodes()) {
    const status: Record<string, boolean | string | number> = {};
    if (
      n.id === "hub:vault-you" ||
      n.id === "hub:vault-intelligence" ||
      n.id === "hub:vault"
    ) {
      status.connected = vaultAny;
    }
    if (n.id === "vault:llm") {
      status.connected = slotConnected(vaultHints, [
        "openrouter",
        "openai",
        "anthropic",
        "llm",
        "api_key",
        "cursor",
      ]);
    }
    if (n.id === "vault:github") {
      status.connected = slotConnected(vaultHints, ["github", "gh_"]);
    }
    if (n.id === "vault:exa") {
      status.connected = slotConnected(vaultHints, ["exa", "search"]);
    }
    const attention = attentionStatusForNode(
      n.id,
      missionStatus.attentionByNode
    );
    if (attention) {
      Object.assign(status, attention);
    }
    pushNode(nodes, seenN, {
      id: n.id,
      kind: n.kind,
      label:
        n.id === "hub:you" && opts.userLabel?.trim()
          ? opts.userLabel.trim()
          : n.label,
      objectType: n.objectType,
      refId: n.refId,
      position: n.position,
      description: n.description,
      securityNote: n.securityNote,
      connectionLabels: n.connectionLabels,
      ctaLabel: n.ctaLabel,
      cta: n.cta,
      openImmediate: n.openImmediate,
      windows: n.windows,
      status: Object.keys(status).length ? status : undefined,
    });
  }

  for (const e of listArchitectureCatalogEdges()) {
    pushEdge(edges, seenE, e);
  }

  // Auth enrichment: merge capped live instances into architecture space.
  // Do NOT reuse chat-focus coordinates (those sit near origin and scramble Fit all).
  if (opts.enrichLiveNeighborhood && opts.tenantDb && opts.userId) {
    try {
      mergeLiveNeighborhoodIntoArchitecture({
        nodes,
        edges,
        seenN,
        seenE,
        tenantDb: opts.tenantDb,
        userId: opts.userId,
        userLabel: opts.userLabel,
        cloudDb: opts.cloudDb,
      });
    } catch {
      /* enrichment optional */
    }
  }

  const truncated = nodes.length >= MAX_NODES || edges.length >= MAX_EDGES;
  return {
    focusType: "architecture",
    focusId: "godmode",
    nodes,
    edges,
    truncated,
    catalogVersion: ARCHITECTURE_CATALOG_VERSION,
  };
}
