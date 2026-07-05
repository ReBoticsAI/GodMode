import type { AiAgent } from "@/api";

export type ScopeKind = "department" | "division" | "page";

/** User-facing label — single node type is always "Page". */
export function scopeTypeLabel(_kind: ScopeKind): string {
  return "Page";
}

export function scopeTypeLabelLower(_kind: ScopeKind): string {
  return "page";
}

const PROVISIONED_PREFIXES = ["dept-", "div-", "page-"];

function isProvisionedAgentId(id: string): boolean {
  return PROVISIONED_PREFIXES.some((p) => id.startsWith(p));
}

/** Drop legacy auto-provisioned structure agents (no longer created). */
export function filterAgentsToStructure(agents: AiAgent[]): AiAgent[] {
  return agents.filter((a) => !isProvisionedAgentId(a.id));
}
