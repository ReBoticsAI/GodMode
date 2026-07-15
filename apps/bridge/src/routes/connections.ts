import { Router } from "express";
import { getCoreDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import {
  createBridgeConnection,
  deleteBridgeConnection,
  listBridgeConnections,
} from "../services/bridge-connections.js";
import { resolveConnectionForResource } from "../services/connection-resolver.js";
import { dispatchScLine } from "../services/federation-client.js";
import { getPluginHost } from "@godmode/plugin-host";
import type { MarketplaceListingKind } from "../core-db.js";
import { config } from "../config.js";

export function createConnectionsRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/", (req, res) => {
    const connections = listBridgeConnections(getCoreDb(), req.tenantId!);
    res.json({ connections, bridgePublicUrl: config.auth.publicUrl });
  });

  router.get("/resolve/:kind/:resourceId", (req, res) => {
    const resolved = resolveConnectionForResource(getCoreDb(), {
      userId: req.user!.id,
      tenantId: req.tenantId!,
      resourceKind: req.params.kind as MarketplaceListingKind,
      resourceId: req.params.resourceId,
    });
    res.json({ resolved, bridgePublicUrl: config.auth.publicUrl });
  });

  return router;
}
