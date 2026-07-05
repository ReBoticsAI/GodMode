import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { getCoreDb } from "../core-db.js";
import { getPluginHost } from "@godmode/plugin-host";
import { createShareGrant } from "../services/share-service.js";
import type { MarketplaceListingKind, ShareGrantRole } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
} from "../services/auth/middleware.js";

function scEnqueue(line: string, chartbookKey?: string): string {
  return getPluginHost().enqueueScLine!(line, chartbookKey);
}

function federationAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Federation token required" });
    return;
  }
  const core = getCoreDb();
  const grant = core
    .prepare(
      `SELECT id FROM share_grants WHERE federation_token=? LIMIT 1`
    )
    .get(token);
  const conn = core
    .prepare(
      `SELECT id FROM bridge_connections WHERE remote_bridge_token=? LIMIT 1`
    )
    .get(token);
  const peer = core
    .prepare(`SELECT id FROM peer_connections WHERE federation_token=? LIMIT 1`)
    .get(token);
  const invite = core
    .prepare(
      `SELECT id FROM federated_share_invites WHERE invite_token=? AND status='accepted' LIMIT 1`
    )
    .get(token);
  if (!grant && !conn && !peer && !invite) {
    res.status(403).json({ error: "Invalid federation token" });
    return;
  }
  next();
}

/**
 * Peer Bridge API: authenticated federation surface for remote local connectors.
 * Hardware-bound marketplace plugins execute on the user's machine; remote
 * callers use Bearer tokens minted on share grants or bridge connections.
 */
export function createFederationRouter(deps: {
  pingSc: () => Promise<{ ok: boolean; detail?: string }>;
}): Router {
  const router = Router();

  router.get("/invites/:token", attachAuthContext, requireAuth, (req, res) => {
    const core = getCoreDb();
    const invite = core
      .prepare(
        `SELECT id, resource_kind, resource_id, role, invitee_email, owner_user_id, status, expires_at
         FROM federated_share_invites WHERE invite_token=?`
      )
      .get(String(req.params.token)) as Record<string, unknown> | undefined;
    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const callerEmail = req.user?.email?.trim().toLowerCase() ?? "";
    const inviteeEmail = String(invite.invitee_email ?? "").trim().toLowerCase();
    const isInvitee = callerEmail.length > 0 && callerEmail === inviteeEmail;
    const isOwner = req.user?.id === invite.owner_user_id;
    const payload = { ...invite };
    if (!isInvitee && !isOwner) {
      delete payload.invitee_email;
    }
    res.json({ invite: payload });
  });

  router.post("/invites/:token/accept", attachAuthContext, requireAuth, (req, res) => {
    const core = getCoreDb();
    const token = String(req.params.token);
    const invite = core
      .prepare(`SELECT * FROM federated_share_invites WHERE invite_token=? AND status='pending'`)
      .get(token) as Record<string, unknown> | undefined;
    if (!invite) {
      res.status(404).json({ error: "Invite not found or already accepted" });
      return;
    }
    const expiresAt = invite.expires_at ? Date.parse(String(invite.expires_at)) : NaN;
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      res.status(410).json({ error: "Invite expired" });
      return;
    }
    const callerEmail = req.user?.email?.trim().toLowerCase() ?? "";
    const inviteeEmail = String(invite.invitee_email ?? "").trim().toLowerCase();
    if (!callerEmail || callerEmail !== inviteeEmail) {
      res.status(403).json({ error: "Invite is bound to a different account email" });
      return;
    }
    const {
      granteeUserId,
      granteeTenantId,
      granteeEmail,
      granteeDisplayName,
      granteeBridgeUrl,
    } = req.body ?? {};
    if (!granteeUserId || !granteeTenantId) {
      res.status(400).json({ error: "granteeUserId and granteeTenantId required" });
      return;
    }
    const federationToken = randomUUID();
    const grantId = createShareGrant(core, {
      ownerTenantId: String(invite.owner_tenant_id),
      ownerUserId: String(invite.owner_user_id),
      resourceKind: invite.resource_kind as MarketplaceListingKind,
      resourceId: String(invite.resource_id),
      granteeUserId: String(granteeUserId),
      granteeTenantId: String(granteeTenantId),
      role: (invite.role as ShareGrantRole) ?? "viewer",
      bridgeUrl: config.federation.publicUrl,
      federationToken,
    });
    core.prepare(
      `UPDATE federated_share_invites SET status='accepted' WHERE invite_token=?`
    ).run(token);
    res.json({ grantId, federationToken, ownerBridgeUrl: config.federation.publicUrl });
  });

  router.use(federationAuth);

  router.get("/health", async (_req, res) => {
    const sc = await deps.pingSc();
    res.json({ ok: true, sc });
  });

  router.post("/sc/:verb", async (req, res) => {
    const body = (req.body ?? {}) as {
      line?: string;
      chartbookKey?: string;
      chartNumber?: number;
      deployId?: string;
    };
    if (typeof body.line === "string" && body.line.trim()) {
      const file = scEnqueue(body.line.trim(), body.chartbookKey);
      res.json({ ok: true, verb: req.params.verb, enqueued: body.line.trim(), file });
      return;
    }
    const verb = String(req.params.verb ?? "").toUpperCase();
    if (verb === "ADD" && body.chartNumber && body.deployId) {
      const dllFunc = String((body as { dllFunc?: string }).dllFunc ?? "");
      scEnqueue(`ADD|${body.chartNumber}|${dllFunc}|${body.deployId}`, body.chartbookKey);
      res.json({ ok: true, verb, mode: "add" });
      return;
    }
    res.status(400).json({
      error: "Provide { line } or ADD payload { chartNumber, dllFunc, deployId }",
    });
  });

  router.get("/market/:symbol", (req, res) => {
    res.json({
      ok: true,
      symbol: req.params.symbol,
      mode: "local_read",
      price: null,
      note: "Connector should attach live market feed for this symbol",
    });
  });

  return router;
}
