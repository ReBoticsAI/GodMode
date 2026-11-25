import { getCloudDb, getPlatformMeta, setPlatformMeta } from "../../core-db.js";
import type { RouteDecisionLog } from "./types.js";

const META_DECISIONS = "godmode_inference.auto_decisions_json";
const MAX_DECISIONS = 50;

export function appendRouteDecision(entry: RouteDecisionLog): void {
  try {
    const existing = listRouteDecisions();
    existing.unshift(entry);
    setPlatformMeta(
      getCloudDb(),
      META_DECISIONS,
      JSON.stringify(existing.slice(0, MAX_DECISIONS))
    );
  } catch {
    // ignore when Cloud DB unavailable
  }
}

export function listRouteDecisions(limit = 25): RouteDecisionLog[] {
  try {
    const raw = getPlatformMeta(getCloudDb(), META_DECISIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e === "object")
      .slice(0, Math.max(1, Math.min(limit, MAX_DECISIONS))) as RouteDecisionLog[];
  } catch {
    return [];
  }
}

export function resetRouteDecisionsForTests(): void {
  try {
    getCloudDb()
      .prepare(`DELETE FROM platform_meta WHERE key=?`)
      .run(META_DECISIONS);
  } catch {
    // ignore
  }
}
