import type { LlmManager } from "../llm-manager.js";
import { DEFAULT_MAX_ITERATIONS, runAgentChat, type AgentSampling } from "../ai-agent.js";
import { config } from "../../config.js";
import { getToolSchemasForLlm } from "../ai-tools-registry.js";
import { shouldAutoApproveTool } from "../confirm-policy.js";
import type { AgentBackend, AgentRunRequest } from "./backend.js";
import type { AppDatabase } from "../../db.js";

function filterTools(allow: string[] | null): boolean {
  if (!allow || allow.length === 0) return true;
  return allow.includes("*") || allow.length > 0;
}

export class LocalLlamaBackend implements AgentBackend {
  constructor(
    private llm: LlmManager,
    private db: AppDatabase
  ) {}

  private resolveLora(adapterIds: string[]): Array<{ id: number; scale: number }> {
    if (!adapterIds.length) return [];
    const rows = this.db
      .prepare(`SELECT id, default_scale FROM ai_adapters WHERE enabled = 1`)
      .all() as Array<{ id: string; default_scale: number }>;
    const pathToIndex = new Map<string, number>();
    const enabledPaths = this.llm.getEnabledAdapterPaths();
    enabledPaths.forEach((p, i) => pathToIndex.set(p, i));
    const scales: Array<{ id: number; scale: number }> = [];
    for (const aid of adapterIds) {
      const row = rows.find((r) => r.id === aid);
      if (!row) continue;
      const full = this.db.prepare(`SELECT path FROM ai_adapters WHERE id = ?`).get(aid) as
        | { path: string }
        | undefined;
      if (!full) continue;
      const idx = pathToIndex.get(full.path);
      if (idx != null) scales.push({ id: idx, scale: row.default_scale });
    }
    return scales;
  }

  async run(req: AgentRunRequest): Promise<string> {
    const { agent } = req;
    if (!this.llm.isReady()) {
      if (agent.modelPath) {
        await this.llm.start(agent.modelPath);
      } else {
        throw new Error("LLM server not running. Start a model from AI Builder first.");
      }
    } else if (agent.modelPath) {
      const status = this.llm.getStatus();
      const current = status.modelPath ?? "";
      if (agent.modelPath !== current) {
        await this.llm.restart(agent.modelPath);
      }
    }

    const sampling: AgentSampling = {
      temperature: agent.sampling.temperature,
      topP: agent.sampling.topP,
      topK: agent.sampling.topK,
      minP: agent.sampling.minP,
      repeatPenalty: agent.sampling.repeatPenalty,
      presencePenalty: agent.sampling.presencePenalty,
      frequencyPenalty: agent.sampling.frequencyPenalty,
      maxTokens: agent.sampling.maxTokens,
      seed: agent.sampling.seed,
    };

    const allow = agent.toolAllow;
    const lora = this.resolveLora(agent.adapterIds);

    const chatMode = req.chatMode ?? "agent";
    const allSchemas =
      req.toolSchemas ?? getToolSchemasForLlm(this.db, agent.id, chatMode);
    const allowedNames = allow?.length
      ? new Set(allow.includes("*") ? allSchemas.map((s) => s.function.name) : allow)
      : null;

    return runAgentChat({
      baseUrl: this.llm.getServerBaseUrl(),
      messages: req.messages,
      sampling,
      nativeTools: agent.thinking.nativeTools && chatMode !== "ask",
      toolMode: config.ai.defaultToolMode,
      lora: lora.length ? lora : undefined,
      maxIterations: req.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      tools: allSchemas,
      toolCtx: {
        ...req.toolCtx,
        delegationDepth: req.delegationDepth ?? 0,
      },
      abortSignal: req.abortSignal,
      onToken: req.onToken,
      onReasoning: req.onReasoning,
      onToolCall: req.onToolCall,
      onToolCallDelta: req.onToolCallDelta,
      onToolResult: req.onToolResult,
      onTerminalOutput: req.onTerminalOutput,
      onConfirmRequired: async (payload) => {
        if (!filterTools(allow) && allowedNames && !allowedNames.has(payload.name)) {
          return false;
        }
        return shouldAutoApproveTool(
          agent,
          payload.name,
          req.onConfirmRequired,
          payload,
          req.toolCtx.sessionAutonomy
        );
      },
    });
  }
}
