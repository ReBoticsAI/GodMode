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

  router.post("/", (req, res) => {
    const mode = req.body?.mode === "remote" ? "remote" : "local";
    if (mode === "local") {
      const label =
        typeof req.body?.label === "string" && req.body.label.trim()
          ? req.body.label.trim()
          : "Local connector";
      const core = getCoreDb();
      const existing = listBridgeConnections(core, req.tenantId!).find(
        (c) => c.mode === "local"
      );
      if (existing) {
        res.json({ connection: existing });
        return;
      }
      const connection = createBridgeConnection(core, {
        ownerTenantId: req.tenantId!,
        ownerUserId: req.user!.id,
        label,
        mode: "local",
      });
      res.status(201).json({ connection });
      return;
    }
    const { label, remoteBridgeUrl, remoteBridgeToken } = req.body ?? {};
    if (typeof remoteBridgeUrl !== "string" || !remoteBridgeUrl.trim()) {
      res.status(400).json({ error: "remoteBridgeUrl required" });
      return;
    }
    if (typeof remoteBridgeToken !== "string" || !remoteBridgeToken.trim()) {
      res.status(400).json({ error: "remoteBridgeToken required" });
      return;
    }
    const connection = createBridgeConnection(getCoreDb(), {
      ownerTenantId: req.tenantId!,
      ownerUserId: req.user!.id,
      label:
        typeof label === "string" && label.trim() ? label.trim() : "Remote Bridge",
      mode: "remote",
      remoteBridgeUrl: remoteBridgeUrl.trim(),
      remoteBridgeToken: remoteBridgeToken.trim(),
    });
    res.status(201).json({ connection });
  });

  router.delete("/:id", (req, res) => {
    const core = getCoreDb();
    const row = listBridgeConnections(core, req.tenantId!).find(
      (c) => c.id === req.params.id
    );
    if (!row) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }
    deleteBridgeConnection(core, req.params.id);
    res.json({ ok: true });
  });

  router.post("/local", (req, res) => {
    const label =
      typeof req.body?.label === "string" && req.body.label.trim()
        ? req.body.label.trim()
        : "Local connector";
    const core = getCoreDb();
    const existing = listBridgeConnections(core, req.tenantId!).find(
      (c) => c.mode === "local"
    );
    if (existing) {
      res.json({ connection: existing, created: false });
      return;
    }
    const connection = createBridgeConnection(core, {
      ownerTenantId: req.tenantId!,
      ownerUserId: req.user!.id,
      label,
      mode: "local",
    });
    res.status(201).json({ connection, created: true });
  });

  router.post("/remote", (req, res) => {
    const { label, remoteBridgeUrl, remoteBridgeToken } = req.body ?? {};
    if (typeof remoteBridgeUrl !== "string" || !remoteBridgeUrl.trim()) {
      res.status(400).json({ error: "remoteBridgeUrl required" });
      return;
    }
    if (typeof remoteBridgeToken !== "string" || !remoteBridgeToken.trim()) {
      res.status(400).json({ error: "remoteBridgeToken required" });
      return;
    }
    const connection = createBridgeConnection(getCoreDb(), {
      ownerTenantId: req.tenantId!,
      ownerUserId: req.user!.id,
      label:
        typeof label === "string" && label.trim() ? label.trim() : "Remote Bridge",
      mode: "remote",
      remoteBridgeUrl: remoteBridgeUrl.trim(),
      remoteBridgeToken: remoteBridgeToken.trim(),
    });
    res.status(201).json({ connection });
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

  router.post("/federation/execute", async (req, res) => {
    const { resourceKind, resourceId, line, chartbookKey } = req.body ?? {};
    if (typeof line !== "string" || !line.trim()) {
      res.status(400).json({ error: "line required" });
      return;
    }
    if (typeof resourceKind !== "string" || typeof resourceId !== "string") {
      res.status(400).json({ error: "resourceKind and resourceId required" });
      return;
    }
    const resolved = resolveConnectionForResource(getCoreDb(), {
      userId: req.user!.id,
      tenantId: req.tenantId!,
      resourceKind: resourceKind as MarketplaceListingKind,
      resourceId,
    });
    const result = await dispatchScLine({
      resolved,
      line: line.trim(),
      chartbookKey: typeof chartbookKey === "string" ? chartbookKey : undefined,
      localEnqueue: (line, chartbookKey) =>
        getPluginHost().enqueueScLine!(line, chartbookKey),
    });
    res.status(result.ok ? 200 : 502).json(result);
  });

  return router;
}
