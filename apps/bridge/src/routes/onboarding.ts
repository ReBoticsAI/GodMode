import { Router } from "express";
import { attachAuthContext, requireAuth, tenantDbMiddleware } from "../services/auth/middleware.js";
import type { LlmManager } from "../services/llm-manager.js";
import {
  detectOllama,
  getOnboardingStatus,
  listLocalGgufModels,
  markLlmReady,
  markOnboardingComplete,
} from "../services/onboarding.js";

export function createOnboardingRouter(llm: LlmManager): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, tenantDbMiddleware);

  router.get("/status", (req, res) => {
    res.json(getOnboardingStatus(llm, req.tenantDb ?? null));
  });

  router.get("/detect", async (_req, res) => {
    const ollama = await detectOllama();
    const localModels = listLocalGgufModels();
    res.json({ ollama, localModels });
  });

  return router;
}
