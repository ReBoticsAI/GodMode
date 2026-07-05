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

  router.post("/tailscale/enable", (_req, res) => {
    res.json(enableTailscaleFederation());
  });

  router.get("/peers", (req, res) => {
    const core = getCoreDb();
    res.json({ peers: listPeerConnections(core, req.user!.id) });
  });

  router.post("/peers/invite", (req, res) => {
    const { email, remoteBridgeUrl } = req.body ?? {};
    if (!email) {
      res.status(400).json({ error: "email required" });
      return;
    }
    const core = getCoreDb();
    const result = invitePeerByEmail(core, req.user!.id, String(email), remoteBridgeUrl);
    res.status(201).json(result);
  });

  router.post("/peers/refresh", async (req, res) => {
    const core = getCoreDb();
    await refreshPeerHealth(core, req.user!.id);
    res.json({ peers: listPeerConnections(core, req.user!.id) });
  });

  router.post("/share-invites", (req, res) => {
    const { resourceKind, resourceId, role, inviteeEmail } = req.body ?? {};
    if (!resourceKind || !resourceId || !inviteeEmail) {
      res.status(400).json({ error: "resourceKind, resourceId, inviteeEmail required" });
      return;
    }
    const core = getCoreDb();
    const result = createFederatedShareInvite(core, {
      ownerTenantId: req.tenantId!,
      ownerUserId: req.user!.id,
      resourceKind: String(resourceKind) as MarketplaceListingKind,
      resourceId: String(resourceId),
      role: role ?? "viewer",
      inviteeEmail: String(inviteeEmail),
    });
    res.status(201).json(result);
  });

  router.post("/share-invites/accept", async (req, res) => {
    const { inviteToken, ownerBridgeUrl } = req.body ?? {};
    if (!inviteToken || !ownerBridgeUrl) {
      res.status(400).json({ error: "inviteToken and ownerBridgeUrl required" });
      return;
    }
    try {
      const ownerBase = String(ownerBridgeUrl).replace(/\/$/, "");
      const acceptRes = await fetch(
        `${ownerBase}/api/federation/invites/${encodeURIComponent(String(inviteToken))}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            granteeUserId: req.user!.id,
            granteeTenantId: req.tenantId,
            granteeEmail: req.user!.email,
            granteeDisplayName: req.user!.displayName,
            granteeBridgeUrl: config.federation.publicUrl,
          }),
        }
      );
      const data = (await acceptRes.json()) as Record<string, unknown>;
      if (!acceptRes.ok) {
        res.status(acceptRes.status).json(data);
        return;
      }
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to accept invite",
      });
    }
  });

  return router;
}
