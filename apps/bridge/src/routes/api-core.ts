import { Router, type Request } from "express";
import type { EventEmitter } from "node:events";
import {
  getStorageUsage,
  formatBytes,
} from "../services/storage-usage.js";
import { getTimeseriesStore } from "../services/timeseries-store.js";
import { requirePlatformAdmin } from "../services/auth/middleware.js";
import type { AppDatabase } from "../db.js";
import {
  readStructure,
  structureNodesToLegacy,
  StructureError,
  type ReorderKind,
} from "../services/structure.js";
import {
  readStructureGraphRecord,
  writeStructureGraphLayout,
} from "../services/structure-graph-service.js";
import { requireTenantRole } from "../services/auth/middleware.js";
import {
  createRecord,
  deleteRecord,
  executeCollectionAction,
  executeRecordAction,
  KernelError,
  updateRecord,
} from "../kernel/record-api.js";
import type { OperationContext } from "../kernel/adapter-registry.js";

export interface CoreApiDeps {
  bus?: EventEmitter;
}

export function createCoreApiRouter(
  operatorDb: AppDatabase,
  deps: CoreApiDeps = {}
): Router {
  const router = Router();
  const tdb = (req: Request): AppDatabase => req.tenantDb ?? operatorDb;
  const requireEditor = requireTenantRole("editor");
  const kernelContext = (req: Request): OperationContext => ({
    tenantId: req.tenantId,
    userId: req.user?.id,
    isAdmin: req.user?.isAdmin,
    role: req.tenantRole ?? "viewer",
    source: "http",
    bus: deps.bus,
  });

  router.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    requireEditor(req, res, next);
  });

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mode: "core",
      timestamp: new Date().toISOString(),
    });
  });

  const handleStructureError = (
    err: unknown,
    res: import("express").Response
  ): void => {
    if (err instanceof StructureError || err instanceof KernelError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("[structure] unexpected error", err);
    res.status(500).json({ error: "internal error" });
  };

  router.get("/structure", (req, res) => {
    try {
      res.json(readStructure(tdb(req)));
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.get("/structure/graph", (req, res) => {
    try {
      res.json(readStructureGraphRecord(tdb(req)));
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.get("/storage/usage", (req, res) => {
    try {
      const report = getStorageUsage(tdb(req));
      res.json({
        ...report,
        entries: report.entries.map((e) => ({
          ...e,
          bytesLabel: formatBytes(e.bytes),
        })),
        totalBytesLabel: formatBytes(report.totalBytes),
        diskFreeBytesLabel:
          report.diskFreeBytes != null ? formatBytes(report.diskFreeBytes) : null,
        diskTotalBytesLabel:
          report.diskTotalBytes != null ? formatBytes(report.diskTotalBytes) : null,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "storage usage failed",
      });
    }
  });

  router.post("/analytics/timeseries/query", requirePlatformAdmin, async (req, res) => {
    const sql = String(req.body?.sql ?? "").trim();
    if (!sql) {
      res.status(400).json({ error: "sql required" });
      return;
    }
    if (!/^select\s/i.test(sql) || /;/.test(sql)) {
      res.status(400).json({ error: "only single SELECT queries allowed" });
      return;
    }
    const forbidden = /\b(read_csv|read_blob|read_parquet|attach|copy|pragma|install|load)\b/i;
    if (forbidden.test(sql)) {
      res.status(400).json({ error: "query contains disallowed functions" });
      return;
    }
    try {
      const rows = await getTimeseriesStore().analyticsQuery(sql);
      res.json({ rows });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "query failed",
      });
    }
  });

  return router;
}
