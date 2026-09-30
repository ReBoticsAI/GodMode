/**
 * Single ownership rule for Graph Information surfaces.
 * Derived from the selected Graph node (`informationNode`), not from a stale
 * `activeAgentId`. See docs/GRAPH_CHROME.md.
 */

import type { GraphProjectionNode } from "@/api";
import type { ProductivityScope } from "@/lib/productivity-scope";

export type FocusOwner =
  | { kind: "user" }
  | { kind: "agent"; agentId: string }
  | { kind: "none" };

const SIDE_SUFFIXES = ["you", "intelligence", "research", "ops"] as const;
export type SideSuffix = (typeof SIDE_SUFFIXES)[number];

function sideFromSuffix(suffix: SideSuffix): FocusOwner {
  if (suffix === "you") return { kind: "user" };
  return { kind: "agent", agentId: suffix };
}

/** Catalog side suffix for You / Intelligence / Research / Ops; null for none or custom agents. */
export function sideSuffixFromFocusOwner(owner: FocusOwner): SideSuffix | null {
  if (owner.kind === "user") return "you";
  if (owner.kind === "agent") {
    if (
      owner.agentId === "intelligence" ||
      owner.agentId === "research" ||
      owner.agentId === "ops"
    ) {
      return owner.agentId;
    }
    return null;
  }
  return null;
}

/**
 * Rewrite owner-sided hub ids (`hub:calendar-you`, `hub:bank-you`, …) to the
 * current focusOwner side. Non-sided catalog ids and unknown owners stay as-is.
 */
export function resolveFloatingNodeId(
  catalogNodeId: string | null,
  focusOwner?: FocusOwner | null
): string | null {
  if (!catalogNodeId) return null;
  if (!focusOwner || focusOwner.kind === "none") return catalogNodeId;
  const side = sideSuffixFromFocusOwner(focusOwner);
  if (!side) return catalogNodeId;
  const match = catalogNodeId.match(
    /^hub:([a-z0-9]+)-(you|intelligence|research|ops)$/
  );
  if (!match) return catalogNodeId;
  return `hub:${match[1]}-${side}`;
}

/** Normalize catalog / chat agent ids into FocusOwner. */
export function focusOwnerFromAgentId(
  agentId: string | null | undefined
): FocusOwner {
  const raw = (agentId ?? "").trim().toLowerCase();
  if (!raw) return { kind: "none" };
  if (raw === "user" || raw === "digital-you" || raw === "you" || raw === "local") {
    return { kind: "user" };
  }
  if (
    raw === "intelligence" ||
    raw === "research" ||
    raw === "ops"
  ) {
    return { kind: "agent", agentId: raw };
  }
  return { kind: "agent", agentId: agentId!.trim() };
}

function sideSuffixFromNodeId(id: string): SideSuffix | null {
  for (const side of SIDE_SUFFIXES) {
    if (id === `hub:${side}` || id.endsWith(`-${side}`)) return side;
  }
  if (id === "hub:agent-research") return "research";
  if (id === "hub:agent-ops") return "ops";
  return null;
}

/**
 * Derive the Information-panel owner from a Graph projection node.
 * Prefers hub id / side suffix over schedule refIds like `calendar-intelligence`.
 */
export function focusOwnerFromGraphNode(
  node: GraphProjectionNode | null | undefined
): FocusOwner {
  if (!node) return { kind: "none" };

  const fromId = sideSuffixFromNodeId(node.id);
  if (fromId) return sideFromSuffix(fromId);

  if (
    (node.kind === "agent" || node.kind === "chat") &&
    typeof node.refId === "string" &&
    node.refId.trim()
  ) {
    return focusOwnerFromAgentId(node.refId);
  }

  if (node.kind === "user") return { kind: "user" };

  return { kind: "none" };
}

/** Map FocusOwner to Calendar / productivity APIs. null when none. */
export function productivityScopeFromFocusOwner(
  owner: FocusOwner
): ProductivityScope | null {
  if (owner.kind === "user") return { kind: "user" };
  if (owner.kind === "agent") return { kind: "agent", agentId: owner.agentId };
  return null;
}

/** Display label for focus chrome (possessive owner name). */
export function focusOwnerLabel(owner: FocusOwner): string | null {
  if (owner.kind === "user") return "You";
  if (owner.kind === "agent") {
    if (owner.agentId === "intelligence") return "Intelligence";
    if (owner.agentId === "research") return "Research";
    if (owner.agentId === "ops") return "Ops";
    if (owner.agentId === "digital-you") return "You";
    return owner.agentId
      .split(/[-_]/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
  }
  return null;
}

/** Agent id for Automations / Bank / agent Vault; null for user or none. */
export function agentIdFromFocusOwner(owner: FocusOwner): string | null {
  return owner.kind === "agent" ? owner.agentId : null;
}
