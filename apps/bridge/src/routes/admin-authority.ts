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
import {
  getSpendKillState,
  setGlobalSpendKill,
  setTenantSpendKill,
} from "../services/authority/spend-kill-switch.js";
import {
  getSpendAuthorityStatus,
  listSpendAuthorityEvents,
} from "../services/authority/spend-authority-admin.js";
import {
  getDeployKillState,
  setGlobalDeployKill,
  setTenantDeployKill,
} from "../services/authority/deploy-kill-switch.js";
import {
  getDeployAuthorityStatus,
  listDeployAuthorityEvents,
} from "../services/authority/deploy-authority-admin.js";
import {
  getDeleteKillState,
  setGlobalDeleteKill,
  setTenantDeleteKill,
} from "../services/authority/delete-kill-switch.js";
import {
  getDeleteAuthorityStatus,
  listDeleteAuthorityEvents,
} from "../services/authority/delete-authority-admin.js";
import {
  getSendKillState,
  setGlobalSendKill,
  setTenantSendKill,
} from "../services/authority/send-kill-switch.js";
import {
  getSendAuthorityStatus,
  listSendAuthorityEvents,
} from "../services/authority/send-authority-admin.js";
import { listAuthorityAuditEvents } from "../services/authority/authority-audit-admin.js";

export function createAdminAuthorityRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/audit-events", (req, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 100);
      const domain =
        typeof req.query.domain === "string" ? req.query.domain : undefined;
      const tenantId =
        typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
      const events = listAuthorityAuditEvents({
        limit: limitRaw,
        domain,
        tenantId,
      });
      res.json({ events });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

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

  router.get("/spend-kills", (_req, res) => {
    const tenantIds = listAllTenantIds(getCoreDb());
    res.json(getSpendKillState(tenantIds));
  });

  router.get("/spend-status", (_req, res) => {
    try {
      res.json(getSpendAuthorityStatus());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/spend-events", (req, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 100);
      const events = listSpendAuthorityEvents(limitRaw);
      res.json({ events });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/spend-kills/global", (req, res) => {
    const spendDisabled =
      req.body?.spendDisabled === undefined
        ? undefined
        : Boolean(req.body.spendDisabled);
    if (spendDisabled === undefined) {
      res.status(400).json({ error: "spendDisabled required" });
      return;
    }
    setGlobalSpendKill({ spendDisabled });
    res.json(getSpendKillState(listAllTenantIds(getCoreDb())));
  });

  router.post("/spend-kills/tenant/:tenantId", (req, res) => {
    const tenantId =
      typeof req.params.tenantId === "string" ? req.params.tenantId.trim() : "";
    if (!tenantId) {
      res.status(400).json({ error: "tenantId required" });
      return;
    }
    const spendDisabled =
      req.body?.spendDisabled === undefined
        ? undefined
        : Boolean(req.body.spendDisabled);
    if (spendDisabled === undefined) {
      res.status(400).json({ error: "spendDisabled required" });
      return;
    }
    setTenantSpendKill(tenantId, { spendDisabled });
    res.json(getSpendKillState([tenantId]));
  });

  router.get("/deploy-kills", (_req, res) => {
    const tenantIds = listAllTenantIds(getCoreDb());
    res.json(getDeployKillState(tenantIds));
  });

  router.get("/deploy-status", (_req, res) => {
    try {
      res.json(getDeployAuthorityStatus());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/deploy-events", (req, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 100);
      const events = listDeployAuthorityEvents(limitRaw);
      res.json({ events });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/deploy-kills/global", (req, res) => {
    const deployDisabled =
      req.body?.deployDisabled === undefined
        ? undefined
        : Boolean(req.body.deployDisabled);
    if (deployDisabled === undefined) {
      res.status(400).json({ error: "deployDisabled required" });
      return;
    }
    setGlobalDeployKill({ deployDisabled });
    res.json(getDeployKillState(listAllTenantIds(getCoreDb())));
  });

  router.post("/deploy-kills/tenant/:tenantId", (req, res) => {
    const tenantId =
      typeof req.params.tenantId === "string" ? req.params.tenantId.trim() : "";
    if (!tenantId) {
      res.status(400).json({ error: "tenantId required" });
      return;
    }
    const deployDisabled =
      req.body?.deployDisabled === undefined
        ? undefined
        : Boolean(req.body.deployDisabled);
    if (deployDisabled === undefined) {
      res.status(400).json({ error: "deployDisabled required" });
      return;
    }
    setTenantDeployKill(tenantId, { deployDisabled });
    res.json(getDeployKillState([tenantId]));
  });

  router.get("/delete-kills", (_req, res) => {
    const tenantIds = listAllTenantIds(getCoreDb());
    res.json(getDeleteKillState(tenantIds));
  });

  router.get("/delete-status", (_req, res) => {
    try {
      res.json(getDeleteAuthorityStatus());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/delete-events", (req, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 100);
      const events = listDeleteAuthorityEvents(limitRaw);
      res.json({ events });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/delete-kills/global", (req, res) => {
    const deleteDisabled =
      req.body?.deleteDisabled === undefined
        ? undefined
        : Boolean(req.body.deleteDisabled);
    if (deleteDisabled === undefined) {
      res.status(400).json({ error: "deleteDisabled required" });
      return;
    }
    setGlobalDeleteKill({ deleteDisabled });
    res.json(getDeleteKillState(listAllTenantIds(getCoreDb())));
  });

  router.post("/delete-kills/tenant/:tenantId", (req, res) => {
    const tenantId =
      typeof req.params.tenantId === "string" ? req.params.tenantId.trim() : "";
    if (!tenantId) {
      res.status(400).json({ error: "tenantId required" });
      return;
    }
    const deleteDisabled =
      req.body?.deleteDisabled === undefined
        ? undefined
        : Boolean(req.body.deleteDisabled);
    if (deleteDisabled === undefined) {
      res.status(400).json({ error: "deleteDisabled required" });
      return;
    }
    setTenantDeleteKill(tenantId, { deleteDisabled });
    res.json(getDeleteKillState([tenantId]));
  });

  router.get("/send-kills", (_req, res) => {
    const tenantIds = listAllTenantIds(getCoreDb());
    res.json(getSendKillState(tenantIds));
  });

  router.get("/send-status", (_req, res) => {
    try {
      res.json(getSendAuthorityStatus());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/send-events", (req, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 100);
      const events = listSendAuthorityEvents(limitRaw);
      res.json({ events });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/send-kills/global", (req, res) => {
    const sendDisabled =
      req.body?.sendDisabled === undefined
        ? undefined
        : Boolean(req.body.sendDisabled);
    if (sendDisabled === undefined) {
      res.status(400).json({ error: "sendDisabled required" });
      return;
    }
    setGlobalSendKill({ sendDisabled });
    res.json(getSendKillState(listAllTenantIds(getCoreDb())));
  });

  router.post("/send-kills/tenant/:tenantId", (req, res) => {
    const tenantId =
      typeof req.params.tenantId === "string" ? req.params.tenantId.trim() : "";
    if (!tenantId) {
      res.status(400).json({ error: "tenantId required" });
      return;
    }
    const sendDisabled =
      req.body?.sendDisabled === undefined
        ? undefined
        : Boolean(req.body.sendDisabled);
    if (sendDisabled === undefined) {
      res.status(400).json({ error: "sendDisabled required" });
      return;
    }
    setTenantSendKill(tenantId, { sendDisabled });
    res.json(getSendKillState([tenantId]));
  });

  return router;
}
