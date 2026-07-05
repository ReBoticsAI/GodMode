import type { CoreDatabase } from "../../core-db.js";
import type { LlmManager } from "../llm-manager.js";
import { runRemoteInference } from "../inference-service.js";
import type { AgentBackend, AgentRunRequest } from "./backend.js";

export class RemoteInferenceBackend implements AgentBackend {
  constructor(
    private core: CoreDatabase,
    private llm: LlmManager
  ) {}

  async run(req: AgentRunRequest): Promise<string> {
    const endpointId = String(req.agent.config.endpointId ?? "");
    if (!endpointId) {
      throw new Error("Remote agent missing config.endpointId");
    }
    const buyerUserId = req.toolCtx.userId ?? "";
    if (!buyerUserId) throw new Error("Remote inference requires authenticated user");

    return runRemoteInference(this.core, this.llm, {
      endpointId,
      buyerUserId,
      buyerTenantId: req.toolCtx.tenantId ?? "",
      messages: req.messages,
      sampling: {
        temperature: req.agent.sampling.temperature,
        topP: req.agent.sampling.topP,
        topK: req.agent.sampling.topK,
        minP: req.agent.sampling.minP,
        repeatPenalty: req.agent.sampling.repeatPenalty,
        presencePenalty: req.agent.sampling.presencePenalty,
        frequencyPenalty: req.agent.sampling.frequencyPenalty,
        maxTokens: req.agent.sampling.maxTokens,
        seed: req.agent.sampling.seed,
      },
      onToken: req.onToken,
    });
  }
}
