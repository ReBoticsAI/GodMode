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

  router.post("/llm/local", async (req, res) => {
    const model = String(req.body?.modelPath ?? req.body?.model ?? "");
    if (!model) {
      res.status(400).json({ error: "modelPath required" });
      return;
    }
    const db = req.tenantDb;
    if (!db) {
      res.status(400).json({ error: "No active workspace" });
      return;
    }
    try {
      await llm.start(model);
      markLlmReady(db);
      res.json({ ok: true, status: llm.getStatus() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/llm/cloud-ready", (req, res) => {
    const db = req.tenantDb;
    if (!db) {
      res.status(400).json({ error: "No active workspace" });
      return;
    }
    markLlmReady(db);
    res.json({ ok: true });
  });

  router.post("/complete", (req, res) => {
    const db = req.tenantDb;
    if (!db) {
      res.status(400).json({ error: "No active workspace" });
      return;
    }
    markOnboardingComplete(db);
    res.json({ ok: true });
  });

  return router;
}
