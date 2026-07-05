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

  router.post("/endpoints", (req, res) => {
    const { name, baseModelPath, adapterIds, meterUnit, meterRate, capacityHint } =
      req.body ?? {};
    if (typeof name !== "string" || typeof baseModelPath !== "string") {
      res.status(400).json({ error: "name and baseModelPath required" });
      return;
    }
    const id = createInferenceEndpoint(getCoreDb(), {
      ownerTenantId: req.tenantId!,
      ownerUserId: req.user!.id,
      name,
      baseModelPath,
      adapterIds: Array.isArray(adapterIds) ? adapterIds.map(String) : undefined,
      meterUnit: typeof meterUnit === "string" ? meterUnit : undefined,
      meterRate: meterRate != null ? Number(meterRate) : undefined,
      capacityHint: capacityHint != null ? Number(capacityHint) : undefined,
    });
    res.status(201).json({ id });
  });

  router.post("/run", (req, res) => {
    const { endpointId, messages, sampling } = req.body ?? {};
    if (typeof endpointId !== "string" || !Array.isArray(messages)) {
      res.status(400).json({ error: "endpointId and messages required" });
      return;
    }
    const base = llm.getSamplingParams();
    const merged: AgentSampling = {
      ...base,
      ...(sampling && typeof sampling === "object" ? sampling : {}),
    };
    void runRemoteInference(getCoreDb(), llm, {
      endpointId,
      buyerUserId: req.user!.id,
      buyerTenantId: req.tenantId!,
      messages: messages.map((m: { role?: string; content?: string }) => ({
        role: toRole(m.role),
        content: String(m.content ?? ""),
      })),
      sampling: merged,
    })
      .then((text) => res.json({ ok: true, content: text }))
      .catch((err) => {
        const status = err instanceof CreditsError ? err.status : 500;
        res
          .status(status)
          .json({ error: err instanceof Error ? err.message : "Inference failed" });
      });
  });

  return router;
}
