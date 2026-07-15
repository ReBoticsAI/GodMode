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

  // Models shared WITH the caller (incoming `model` grants → endpoint + owner).
  router.get("/models", (req, res) => {
    res.json({ models: listSharedModelsForUser(getCoreDb(), req.user!.id) });
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

  return router;
}
