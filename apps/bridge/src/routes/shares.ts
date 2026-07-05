import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { getCoreDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
  requireEditorForMutation,
  getReqTenantDb,
} from "../services/auth/middleware.js";
import {
  createShareGrant,
  listShareGrantsForResource,
  listShareGrantsForUser,
  listSharedModelsForUser,
  buildSharedSidebarTree,
  resolveShareAccess,
  revokeShareGrant,
  ShareError,
  assertShareRole,
} from "../services/share-service.js";
import {
  createInferenceEndpoint,
  findActiveEndpointByModelPath,
} from "../services/inference-service.js";
import { exportEntity, importEntity } from "../services/portability.js";
import type { MarketplaceListingKind, ShareGrantRole } from "../core-db.js";
import { getShareBroker } from "../ws-broker.js";
import { getUserOwnerTenantId } from "../services/user-scope.js";

export function createSharesRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant, requireEditorForMutation);

  router.get("/", (req, res) => {
    const core = getCoreDb();
    const userId = req.user!.id;
    res.json({
      grants: listShareGrantsForUser(core, userId),
      sharedTree: buildSharedSidebarTree(core, userId),
    });
  });

  router.post("/", (req, res) => {
    const {
      resourceKind,
      resourceId,
      granteeUserId,
      granteeTenantId,
      role,
    } = req.body ?? {};
    if (typeof resourceKind !== "string" || typeof resourceId !== "string") {
      res.status(400).json({ error: "resourceKind and resourceId required" });
      return;
    }
    // Plugin-backed resources (departments/divisions) carry federation metadata
    // so the grantee's Bridge can proxy SC operations to the owner's Bridge.
    const isScResource =
      resourceKind === "department" || resourceKind === "division";
    const isUserProductivity =
      resourceKind === "user_calendar" || resourceKind === "user_tasks";
    const ownerTenantId = isUserProductivity
      ? getUserOwnerTenantId(req.user!.id)
      : req.tenantId!;
    try {
      const id = createShareGrant(getCoreDb(), {
        ownerTenantId,
        ownerUserId: req.user!.id,
        resourceKind: resourceKind as MarketplaceListingKind,
        resourceId,
        granteeUserId:
          typeof granteeUserId === "string" ? granteeUserId : undefined,
        granteeTenantId:
          typeof granteeTenantId === "string" ? granteeTenantId : undefined,
        role: (role as ShareGrantRole) ?? "viewer",
        bridgeUrl: isScResource ? config.federation.publicUrl : null,
        federationToken: isScResource ? uuidv4() : null,
      });
      getShareBroker().broadcastResource(
        resourceKind,
        resourceId,
        { type: "share_granted", grantId: id }
      );
      res.status(201).json({ id });
    } catch (err) {
      if (err instanceof ShareError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Free friend-to-friend model sharing. Resolves (or de-dupes) an inference
  // endpoint for the owner's local model path, then grants a `model` share to
  // the friend. No marketplace listing, no credits — `runRemoteInference`
  // treats `model` grants as free.
  router.post("/model", (req, res) => {
    const core = getCoreDb();
    const { modelPath, granteeUserId, granteeEmail, name } = req.body ?? {};
    if (typeof modelPath !== "string" || !modelPath.trim()) {
      res.status(400).json({ error: "modelPath required" });
      return;
    }
    let resolvedGranteeUserId: string | undefined =
      typeof granteeUserId === "string" && granteeUserId.trim()
        ? granteeUserId.trim()
        : undefined;
    if (!resolvedGranteeUserId && typeof granteeEmail === "string" && granteeEmail.trim()) {
      const row = core
        .prepare("SELECT id FROM users WHERE email=?")
        .get(granteeEmail.trim().toLowerCase()) as { id: string } | undefined;
      if (!row) {
        res.status(404).json({ error: "No user with that email" });
        return;
      }
      resolvedGranteeUserId = row.id;
    }
    if (!resolvedGranteeUserId) {
      res.status(400).json({ error: "granteeUserId or granteeEmail required" });
      return;
    }
    if (resolvedGranteeUserId === req.user!.id) {
      res.status(400).json({ error: "Cannot share a model with yourself" });
      return;
    }
    const ownerTenantId = req.tenantId!;
    const existing = findActiveEndpointByModelPath(core, req.user!.id, modelPath.trim());
    const derivedName =
      (typeof name === "string" && name.trim()) ||
      modelPath.trim().split(/[\\/]/).pop()!.replace(/\.gguf$/i, "");
    const endpointId =
      (existing?.id as string | undefined) ??
      createInferenceEndpoint(core, {
        ownerTenantId,
        ownerUserId: req.user!.id,
        name: derivedName,
        baseModelPath: modelPath.trim(),
      });
    try {
      const grantId = createShareGrant(core, {
        ownerTenantId,
        ownerUserId: req.user!.id,
        resourceKind: "model",
        resourceId: endpointId,
        granteeUserId: resolvedGranteeUserId,
        role: "viewer",
        bridgeUrl: null,
        federationToken: null,
      });
      getShareBroker().broadcastResource("model", endpointId, {
        type: "share_granted",
        grantId,
      });
      res.status(201).json({ id: grantId, endpointId });
    } catch (err) {
      if (err instanceof ShareError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Models shared WITH the caller (incoming `model` grants → endpoint + owner).
  router.get("/models", (req, res) => {
    res.json({ models: listSharedModelsForUser(getCoreDb(), req.user!.id) });
  });

  router.delete("/:id", (req, res) => {
    try {
      revokeShareGrant(getCoreDb(), req.params.id, req.user!.id);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof ShareError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/resource/:kind/:resourceId", (req, res) => {
    const isUserProductivity =
      req.params.kind === "user_calendar" || req.params.kind === "user_tasks";
    const ownerTenantId = isUserProductivity
      ? getUserOwnerTenantId(req.user!.id)
      : req.tenantId!;
    const grants = listShareGrantsForResource(
      getCoreDb(),
      ownerTenantId,
      req.params.kind,
      req.params.resourceId
    );
    res.json({ grants });
  });

  router.get("/live/:kind/:resourceId", (req, res) => {
    const access = resolveShareAccess(getCoreDb(), {
      userId: req.user!.id,
      tenantId: req.tenantId!,
      resourceKind: req.params.kind as MarketplaceListingKind,
      resourceId: req.params.resourceId,
      minRole: "viewer",
    });
    if (!access) {
      res.status(404).json({ error: "No shared access" });
      return;
    }
    res.json({
      ownerTenantId: access.ownerTenantId,
      role: access.role,
      resourceKind: req.params.kind,
      resourceId: req.params.resourceId,
    });
  });

  router.post("/live/:kind/:resourceId/mutate", (req, res) => {
    const access = resolveShareAccess(getCoreDb(), {
      userId: req.user!.id,
      tenantId: req.tenantId!,
      resourceKind: req.params.kind as MarketplaceListingKind,
      resourceId: req.params.resourceId,
      minRole: "editor",
    });
    if (!access) {
      res.status(403).json({ error: "No edit access" });
      return;
    }
    assertShareRole(access.role, "editor");
    const { action, payload } = req.body ?? {};
    const ownerDb = access.db;
    ownerDb.exec(`
      CREATE TABLE IF NOT EXISTS share_mutation_log (
        id TEXT PRIMARY KEY,
        resource_kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        action TEXT,
        payload_json TEXT,
        actor_user_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    ownerDb.prepare(
      `INSERT INTO share_mutation_log (id, resource_kind, resource_id, action, payload_json, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      req.params.kind,
      req.params.resourceId,
      action != null ? String(action) : null,
      payload != null ? JSON.stringify(payload) : null,
      req.user!.id
    );
    getShareBroker().broadcastResource(
      req.params.kind,
      req.params.resourceId,
      {
        type: "shared_mutation",
        action,
        payload,
        actorUserId: req.user!.id,
        tenantId: req.tenantId,
      }
    );
    res.json({
      ok: true,
      persisted: true,
      ownerTenantId: access.ownerTenantId,
    });
  });

  router.post("/clone/:kind/:resourceId", (req, res) => {
    const access = resolveShareAccess(getCoreDb(), {
      userId: req.user!.id,
      tenantId: req.tenantId!,
      resourceKind: req.params.kind as MarketplaceListingKind,
      resourceId: req.params.resourceId,
      minRole: "viewer",
    });
    const sourceDb = access?.db ?? getReqTenantDb(req);
    try {
      const bundle = exportEntity(
        sourceDb,
        req.params.kind as MarketplaceListingKind,
        req.params.resourceId
      );
      const result = importEntity(getReqTenantDb(req), bundle);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Clone failed" });
    }
  });

  return router;
}
