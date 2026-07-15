import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { AppDatabase } from "../db.js";
import { requireTenantRole } from "../services/auth/middleware.js";
import { getCoreDb } from "../core-db.js";
import { installedPluginIdsForTenant } from "../plugins/plugin-install.js";
import { listPageKinds, isRegisteredPageKind } from "./kind-registry.js";
import {
  createRecord,
  deleteRecord,
  executeCollectionAction,
  executeRecordAction,
  getRecord,
  KernelError,
  listRecords,
  updateRecord,
  listVisibleObjectTypes,
} from "./record-api.js";
import { StructureError } from "../services/structure.js";
import type { EventEmitter } from "node:events";
import type { OperationContext } from "./adapter-registry.js";
import { PROTOCOL_EXCEPTIONS } from "./protocol-exceptions.js";

export function createKernelRouter(
  operatorDb: AppDatabase,
  deps: { bus?: EventEmitter } = {}
): Router {
  const router = Router();
  const tdb = (req: Request): AppDatabase => req.tenantDb ?? operatorDb;
  const requireEditor = requireTenantRole("editor");
  const context = (req: Request): OperationContext => ({
    tenantId: req.tenantId,
    userId: req.user?.id,
    isAdmin: req.user?.isAdmin,
    role: req.tenantRole ?? "viewer",
    source: "http",
    requestId: req.get("X-Request-Id") || randomUUID(),
    idempotencyKey: req.get("Idempotency-Key") || undefined,
    expectedVersion: req.get("If-Match") || undefined,
    confirmationId: req.get("X-Kernel-Confirmation") || undefined,
    bus: deps.bus,
    installedPluginIds: new Set(
      req.tenantId ? installedPluginIdsForTenant(getCoreDb(), req.tenantId) : []
    ),
  });

  router.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    requireEditor(req, res, next);
  });

  const handleErr = (err: unknown, res: import("express").Response): void => {
    if (err instanceof KernelError || err instanceof StructureError) {
      res.status(err.status).json({
        error: {
          code: err instanceof KernelError ? err.code : "STRUCTURE_ERROR",
          message: err.message,
          details: err instanceof KernelError ? err.details : undefined,
          retryable: err instanceof KernelError ? err.retryable : false,
        },
      });
      return;
    }
    console.error("[kernel]", err);
    res.status(500).json({ error: "internal error" });
  };

  router.get("/object-types", (req, res) => {
    res.json({ objectTypes: listVisibleObjectTypes(context(req)) });
  });

  router.get("/kernel/capabilities", (req, res) => {
    res.json({
      contractVersion: 1,
      objectTypes: listVisibleObjectTypes(context(req)),
      protocolExceptions: PROTOCOL_EXCEPTIONS,
    });
  });

  router.get("/object-types/:name", (req, res) => {
    const def = listVisibleObjectTypes(context(req)).find(
      (item) => item.name === req.params.name
    );
    if (!def) {
      res.status(404).json({ error: "ObjectType not found" });
      return;
    }
    res.json(def);
  });

  router.get("/page-kinds", (_req, res) => {
    res.json({ kinds: listPageKinds() });
  });

  router.get("/records/:objectType", (req, res) => {
    try {
      const parentRaw = req.query.parent_id;
      const parentId =
        parentRaw === undefined
          ? undefined
          : parentRaw === "" || parentRaw === "null"
            ? null
            : String(parentRaw);
      const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
      const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
      const filters =
        req.query.filters && typeof req.query.filters === "object"
          ? (req.query.filters as Record<string, unknown>)
          : undefined;
      const direction =
        req.query.direction === "asc" || req.query.direction === "desc"
          ? req.query.direction
          : undefined;
      res.json(
        listRecords(tdb(req), req.params.objectType, {
          parentId,
          limit: Number.isFinite(limit) ? limit : undefined,
          offset: Number.isFinite(offset) ? offset : undefined,
          filters,
          sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
          direction,
        }, context(req))
      );
    } catch (err) {
      handleErr(err, res);
    }
  });

  router.get("/records/:objectType/:id", (req, res) => {
    try {
      res.json(getRecord(tdb(req), req.params.objectType, req.params.id, context(req)));
    } catch (err) {
      handleErr(err, res);
    }
  });

  router.post("/records/:objectType", (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data =
        body.data && typeof body.data === "object"
          ? (body.data as Record<string, unknown>)
          : body;
      if (
        req.params.objectType === "StructureNode" &&
        data.kind != null &&
        !isRegisteredPageKind(String(data.kind))
      ) {
        throw new KernelError(400, `Unknown page kind: ${String(data.kind)}`);
      }
      const row = createRecord(tdb(req), req.params.objectType, data, context(req));
      res.status(201).json(row);
    } catch (err) {
      handleErr(err, res);
    }
  });

  router.put("/records/:objectType/:id", (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data =
        body.data && typeof body.data === "object"
          ? (body.data as Record<string, unknown>)
          : body;
      if (
        req.params.objectType === "StructureNode" &&
        data.kind != null &&
        !isRegisteredPageKind(String(data.kind))
      ) {
        throw new KernelError(400, `Unknown page kind: ${String(data.kind)}`);
      }
      res.json(
        updateRecord(tdb(req), req.params.objectType, req.params.id, data, context(req))
      );
    } catch (err) {
      handleErr(err, res);
    }
  });

  router.delete("/records/:objectType/:id", (req, res) => {
    try {
      deleteRecord(tdb(req), req.params.objectType, req.params.id, context(req));
      res.json({ ok: true });
    } catch (err) {
      handleErr(err, res);
    }
  });

  router.post("/records/:objectType/actions/:action", async (req, res) => {
    try {
      const input =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      const result = await executeCollectionAction(
        tdb(req),
        req.params.objectType,
        req.params.action,
        input,
        context(req)
      );
      res.status(
        result &&
          typeof result === "object" &&
          "status" in result &&
          result.status === "accepted"
          ? 202
          : 200
      ).json({ result });
    } catch (err) {
      handleErr(err, res);
    }
  });

  router.post("/records/:objectType/:id/actions/:action", async (req, res) => {
    try {
      const input =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      const result = await executeRecordAction(
          tdb(req),
          req.params.objectType,
          req.params.id,
          req.params.action,
          input,
          context(req)
        );
      res.status(
        result &&
          typeof result === "object" &&
          "status" in result &&
          result.status === "accepted"
          ? 202
          : 200
      ).json({ result });
    } catch (err) {
      handleErr(err, res);
    }
  });

  return router;
}
