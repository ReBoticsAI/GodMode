import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import { getPersonalOsBootstrapManifest } from "../services/personal-os-structure-manifest.js";

export function createAdminWorkspaceTemplateRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/", (_req, res) => {
    res.json(getPersonalOsBootstrapManifest());
  });

  return router;
}
