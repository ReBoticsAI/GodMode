/**
 * Graph mission catalog + degree-weighted point formula.
 * Spec: docs/GRAPH_MISSIONS.md
 */
import {
  listArchitectureCatalogEdges,
  listArchitectureCatalogNodes,
} from "./graph-architecture-catalog.js";

export const GRAPH_MISSIONS_CATALOG_VERSION = 1;

export type GraphMissionKind = "configure" | "confirm" | "connect";

export type GraphMissionCompleteWhen =
  | "vault_slot"
  | "signed_in"
  | "manual_ack"
  | "surface_opened"
  | "vault_any"
  | "bridge_ok"
  | "chat_sent";

export type GraphMissionDef = {
  id: string;
  nodeId: string;
  title: string;
  description: string;
  kind: GraphMissionKind;
  completeWhen: GraphMissionCompleteWhen;
  /** Comma-separated vault key needles for vault_slot. */
  completeKey?: string;
  basePoints: number;
};

/** MVP seed: architecture hubs + LLM vault slot. */
export function listGraphMissionDefs(): GraphMissionDef[] {
  return [
    {
      id: "you.claim",
      nodeId: "hub:you",
      title: "Claim You",
      description: "Sign in so The Graph knows which Human owns this instance.",
      kind: "confirm",
      completeWhen: "signed_in",
      basePoints: 10,
    },
    {
      id: "vault.llm.connect",
      nodeId: "vault:llm",
      title: "Connect LLM keys",
      description: "Add a model provider key in Intelligence Vault so agents can think.",
      kind: "connect",
      completeWhen: "vault_slot",
      completeKey: "openrouter,openai,anthropic,llm,api_key,cursor",
      basePoints: 25,
    },
    {
      id: "vault.you.open",
      nodeId: "hub:vault-you",
      title: "Open User Vault",
      description:
        "Visit your Vault. Completes when secrets exist, or acknowledge after opening Vault.",
      kind: "configure",
      completeWhen: "manual_ack",
      basePoints: 15,
    },
    {
      id: "intelligence.meet",
      nodeId: "hub:intelligence",
      title: "Meet Intelligence",
      description:
        "Send at least one message to Intelligence. Points award automatically once the chat is saved.",
      kind: "confirm",
      completeWhen: "chat_sent",
      basePoints: 20,
    },
    {
      id: "structure.open",
      nodeId: "hub:structure-you",
      title: "Open Structure",
      description: "Visit your Structure once so anatomy is on your map.",
      kind: "confirm",
      completeWhen: "surface_opened",
      completeKey: "structure",
      basePoints: 12,
    },
    {
      id: "knowledge.open",
      nodeId: "hub:knowledge-you",
      title: "Open Knowledge",
      description: "Visit your Knowledge and acknowledge the memory surface.",
      kind: "confirm",
      completeWhen: "manual_ack",
      basePoints: 12,
    },
    {
      id: "heart.check",
      nodeId: "hub:heart",
      title: "Heart check",
      description: "Confirm Heart (Bridge) is reachable and acknowledge the runtime hub.",
      kind: "confirm",
      completeWhen: "bridge_ok",
      basePoints: 8,
    },
  ];
}

export function getGraphMissionDef(id: string): GraphMissionDef | undefined {
  return listGraphMissionDefs().find((m) => m.id === id);
}

/** Outbound edge count + unique child targets for a catalog node. */
export function catalogNodeDegree(nodeId: string): {
  outbound: number;
  children: number;
  degree: number;
} {
  const edges = listArchitectureCatalogEdges().filter((e) => e.source === nodeId);
  const children = new Set(edges.map((e) => e.target)).size;
  const outbound = edges.length;
  return { outbound, children, degree: outbound + children };
}

/**
 * points = max(1, round(basePoints * (1 + degree)))
 * Same formula on every instance so Cloud boards compare fairly.
 */
export function missionRewardPoints(mission: GraphMissionDef): number {
  const { degree } = catalogNodeDegree(mission.nodeId);
  return Math.max(1, Math.round(mission.basePoints * (1 + degree)));
}

export function assertMissionNodeExists(nodeId: string): boolean {
  return listArchitectureCatalogNodes().some((n) => n.id === nodeId);
}
