import { Router } from "express";
import { listAllTenantIds } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import {
  getCodingKillState,
  setGlobalCodingKill,
  setTenantCodingKill,
} from "../services/coding/coding-kill-switch.js";

export function createAdminAuthorityRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/coding-kills", (_req, res) => {
    const tenantIds = listAllTenantIds();
    res.json(getCodingKillState(tenantIds));
  });

  router.post("/coding-kills/global", (req, res) => {
    const codingDisabled =
      req.body?.codingDisabled === undefined
        ? undefined
        : Boolean(req.body.codingDisabled);
    const buildsDisabled =
      req.body?.buildsDisabled === undefined
        ? undefined
        : Boolean(req.body.buildsDisabled);
    if (codingDisabled === undefined && buildsDisabled === undefined) {
      res.status(400).json({ error: "codingDisabled or buildsDisabled required" });
      return;
    }
    setGlobalCodingKill({ codingDisabled, buildsDisabled });
    res.json(getCodingKillState());
  });

  router.post("/coding-kills/tenant/:tenantId", (req, res) => {
    const tenantId =
      typeof req.params.tenantId === "string" ? req.params.tenantId.trim() : "";
    if (!tenantId) {
      res.status(400).json({ error: "tenantId required" });
      return;
    }
    const codingDisabled =
      req.body?.codingDisabled === undefined
        ? undefined
        : Boolean(req.body.codingDisabled);
    const buildsDisabled =
      req.body?.buildsDisabled === undefined
        ? undefined
        : Boolean(req.body.buildsDisabled);
    if (codingDisabled === undefined && buildsDisabled === undefined) {
      res.status(400).json({ error: "codingDisabled or buildsDisabled required" });
      return;
    }
    setTenantCodingKill(tenantId, { codingDisabled, buildsDisabled });
    res.json(getCodingKillState([tenantId]));
  });

  return router;
}
