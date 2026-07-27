import { Router } from "express";
import { getCoreDb, listAllTenantIds } from "../core-db.js";
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
import {
  getCodingAuthorityStatus,
  listCodingAuthorityEvents,
} from "../services/coding/coding-authority-admin.js";

export function createAdminAuthorityRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/coding-kills", (_req, res) => {
    const tenantIds = listAllTenantIds(getCoreDb());
    res.json(getCodingKillState(tenantIds));
  });

  router.get("/coding-status", async (_req, res) => {
    try {
      res.json(await getCodingAuthorityStatus());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/coding-events", (req, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 100);
      const events = listCodingAuthorityEvents(limitRaw);
      res.json({ events });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
    res.json(getCodingKillState(listAllTenantIds(getCoreDb())));
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
