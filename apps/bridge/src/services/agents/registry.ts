import type { AppDatabase } from "../../db.js";
import type { LlmManager } from "../llm-manager.js";
import { getAgent } from "./agents-db.js";
import type { AiAgent } from "./types.js";
import type { AgentBackend } from "./backend.js";
import { LocalLlamaBackend } from "./local-backend.js";
import { ProviderBackend } from "./provider-backend.js";
import { CliBackend } from "./cli-backend.js";
import { AcpBackend } from "./acp-backend.js";
import { CursorBackend } from "./cursor-backend.js";
import { CursorCloudBackend } from "./cursor-cloud-backend.js";
import { RemoteInferenceBackend } from "./remote-backend.js";
import { getCoreDb } from "../../core-db.js";

export const MAX_DELEGATION_DEPTH = 3;

export function resolveAgent(db: AppDatabase, id?: string | null): AiAgent {
  const agentId = id?.trim() || "intelligence";
  const agent = getAgent(db, agentId);
  if (!agent) {
    const fallback = getAgent(db, "intelligence");
    if (!fallback) throw new Error("Default Intelligence agent not seeded");
    return fallback;
  }
  if (!agent.enabled) throw new Error(`Agent "${agent.name}" is disabled`);
  return agent;
}

export function getBackend(
  agent: AiAgent,
  db: AppDatabase,
  llm: LlmManager
): AgentBackend {
  switch (agent.backend) {
    case "local":
      return new LocalLlamaBackend(llm, db);
    case "provider":
      return new ProviderBackend(db);
    case "cli":
      return new CliBackend();
    case "acp":
      return new AcpBackend();
    case "cursor":
      return new CursorBackend();
    case "cursor_cloud":
      return new CursorCloudBackend(db);
    case "remote":
      return new RemoteInferenceBackend(getCoreDb(), llm);
    default:
      return new LocalLlamaBackend(llm, db);
  }
}
