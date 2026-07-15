import { Router } from "express";
import { getCoreDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import {
  createInferenceEndpoint,
  listInferenceEndpoints,
  runRemoteInference,
} from "../services/inference-service.js";
import type { LlmManager } from "../services/llm-manager.js";
import { CreditsError } from "../services/credits.js";
import type { AgentSampling, AgentMessage } from "../services/ai-agent.js";

function toRole(raw: unknown): AgentMessage["role"] {
  return raw === "system" || raw === "assistant" || raw === "tool"
    ? raw
    : "user";
}

/**
 * Dedicated inference router mounted at /api/inference. Endpoint management
 * mirrors the marketplace router handlers (same inference-service), and
 * POST /run drives a metered remote-inference call through the admission queue.
 */
export function createInferenceRouter(llm: LlmManager): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/endpoints", (req, res) => {
    res.json({ endpoints: listInferenceEndpoints(getCoreDb(), req.user!.id) });
  });

  return router;
}
