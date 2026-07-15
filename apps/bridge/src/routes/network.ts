import { Router } from "express";
import { attachAuthContext, requireAuth, resolveTenant } from "../services/auth/middleware.js";
import { config } from "../config.js";
import { getCoreDb, type MarketplaceListingKind } from "../core-db.js";
import {
  createFederatedShareInvite,
  enableTailscaleFederation,
  getNetworkStatus,
  invitePeerByEmail,
  listPeerConnections,
  refreshPeerHealth,
} from "../services/federation-peers.js";

export function createNetworkRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/status", (_req, res) => {
    res.json(getNetworkStatus());
  });

  router.get("/peers", (req, res) => {
    const core = getCoreDb();
    res.json({ peers: listPeerConnections(core, req.user!.id) });
  });

  return router;
}
