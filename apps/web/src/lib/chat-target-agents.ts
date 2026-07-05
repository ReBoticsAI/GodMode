import type { AiAgent } from "@/api";
import { isUserAgentId } from "@/lib/structure-agents";

/** Legacy contractor agents removed from the platform. */
const HIDDEN_CHAT_AGENT_IDS = new Set(["cursor", "pi"]);

/** Agents eligible for the Intelligence chat target picker. */
export function isChatTargetAgent(agent: Pick<AiAgent, "id" | "isTemplate">): boolean {
  if (HIDDEN_CHAT_AGENT_IDS.has(agent.id)) return false;
  if (agent.id === "intelligence" || agent.isTemplate) return true;
  if (isUserAgentId(agent.id)) return true;
  if (
    agent.id.startsWith("dept-") ||
    agent.id.startsWith("div-") ||
    agent.id.startsWith("page-")
  ) {
    return false;
  }
  return true;
}
