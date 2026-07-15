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

  router.put("/structure/graph/layout", (req, res) => {
    try {
      const layout = req.body?.layout ?? req.body;
      if (!layout || typeof layout !== "object") {
        res.status(400).json({ error: "layout required" });
        return;
      }
      writeStructureGraphLayout(tdb(req), layout);
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/departments", (req, res) => {
    try {
      const body = req.body ?? {};
      createRecord(
        tdb(req),
        "StructureNode",
        {
          id: String(body.id ?? ""),
          parent_id: null,
          label: String(body.label ?? ""),
          icon: String(body.icon ?? ""),
        },
        kernelContext(req)
      );
      const dept = structureNodesToLegacy(readStructure(tdb(req))).departments.find(
        (item) => item.id === String(body.id ?? "")
      );
      res.json(dept);
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.put("/departments/:id", (req, res) => {
    try {
      updateRecord(
        tdb(req),
        "StructureNode",
        req.params.id,
        req.body ?? {},
        kernelContext(req)
      );
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/departments/:id", (req, res) => {
    try {
      deleteRecord(tdb(req), "StructureNode", req.params.id, kernelContext(req));
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/departments/:dept/divisions", (req, res) => {
    try {
      const body = req.body ?? {};
      createRecord(
        tdb(req),
        "StructureNode",
        {
          id: String(body.id ?? ""),
          parent_id: req.params.dept,
          label: String(body.label ?? ""),
          icon: String(body.icon ?? ""),
          right_sidebar: body.rightSidebar,
        },
        kernelContext(req)
      );
      const div = structureNodesToLegacy(readStructure(tdb(req)))
        .departments.find((item) => item.id === req.params.dept)
        ?.divisions.find((item) => item.id === String(body.id ?? ""));
      res.json(div);
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.put("/divisions/:dept/:id", (req, res) => {
    try {
      const body = req.body ?? {};
      updateRecord(
        tdb(req),
        "StructureNode",
        `${req.params.dept}-${req.params.id}`,
        {
          label: body.label,
          icon: body.icon,
          right_sidebar: body.rightSidebar,
        },
        kernelContext(req)
      );
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/divisions/:dept/:id", (req, res) => {
    try {
      deleteRecord(
        tdb(req),
        "StructureNode",
        `${req.params.dept}-${req.params.id}`,
        kernelContext(req)
      );
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/divisions/:dept/:div/pages", (req, res) => {
    try {
      const body = req.body ?? {};
      createRecord(
        tdb(req),
        "StructureNode",
        {
          id: String(body.id ?? ""),
          parent_id: `${req.params.dept}-${req.params.div}`,
          label: String(body.label ?? ""),
          icon: String(body.icon ?? ""),
          segment: String(body.segment ?? ""),
          kind: body.kind ?? body.pageKind,
        },
        kernelContext(req)
      );
      const page = structureNodesToLegacy(readStructure(tdb(req)))
        .departments.find((item) => item.id === req.params.dept)
        ?.divisions.find((item) => item.id === req.params.div)
        ?.pages.find((item) => item.id === String(body.id ?? ""));
      res.json(page);
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.put("/pages/:dept/:div/:id", (req, res) => {
    try {
      const body = req.body ?? {};
      updateRecord(
        tdb(req),
        "StructureNode",
        `${req.params.dept}-${req.params.div}-${req.params.id}`,
        {
          label: body.label,
          icon: body.icon,
          segment: body.segment,
          kind: body.kind ?? body.pageKind,
        },
        kernelContext(req)
      );
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/pages/:dept/:div/:id", (req, res) => {
    try {
      deleteRecord(
        tdb(req),
        "StructureNode",
        `${req.params.dept}-${req.params.div}-${req.params.id}`,
        kernelContext(req)
      );
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/nodes", (req, res) => {
    try {
      const body = req.body ?? {};
      const node = createRecord(tdb(req), "StructureNode", {
        id: String(body.id ?? ""),
        parent_id:
          body.parentId === null || body.parentId === undefined
            ? null
            : String(body.parentId),
        label: String(body.label ?? ""),
        icon: String(body.icon ?? ""),
        segment: body.segment != null ? String(body.segment) : undefined,
        kind: body.kind != null ? String(body.kind) : undefined,
        object_type:
          body.objectType === null
            ? null
            : body.objectType != null
              ? String(body.objectType)
              : undefined,
        right_sidebar:
          body.rightSidebar != null ? String(body.rightSidebar) : undefined,
      }, kernelContext(req));
      res.json({
        id: node.id,
        parentId: node.data.parent_id ?? null,
        label: node.data.label,
        icon: node.data.icon,
        segment: node.data.segment,
        kind: node.data.kind,
        objectType: node.data.object_type ?? null,
        rightSidebar: node.data.right_sidebar ?? null,
        agentId: node.data.agent_id ?? null,
        builtIn: node.data.built_in,
        sortOrder: node.data.sort_order,
        tabs: node.data.tabs_json,
        path: node.data.path,
      });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.put("/nodes/:id", (req, res) => {
    try {
      const body = req.body ?? {};
      updateRecord(
        tdb(req),
        "StructureNode",
        req.params.id,
        {
          label: body.label,
          icon: body.icon,
          segment: body.segment,
          kind: body.kind,
          parent_id: body.parentId,
          object_type: body.objectType,
          right_sidebar: body.rightSidebar,
        },
        kernelContext(req)
      );
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/nodes/:id", (req, res) => {
    try {
      deleteRecord(tdb(req), "StructureNode", req.params.id, kernelContext(req));
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/nodes/:id/agent", async (req, res) => {
    try {
      const agentId =
        req.body?.agentId === null || req.body?.agentId === undefined
          ? null
          : String(req.body.agentId);
      await executeRecordAction(
        tdb(req),
        "StructureNode",
        req.params.id,
        "set_agent",
        { agent_id: agentId },
        kernelContext(req)
      );
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/nodes/:id/agent", async (req, res) => {
    try {
      await executeRecordAction(
        tdb(req),
        "StructureNode",
        req.params.id,
        "set_agent",
        { agent_id: null },
        kernelContext(req)
      );
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/structure/reorder", async (req, res) => {
    try {
      const body = req.body ?? {};
      const orderedIds = Array.isArray(body.orderedIds)
        ? (body.orderedIds as string[])
        : [];
      if (typeof body.parentId === "string" || body.parentId === null) {
        await executeCollectionAction(
          tdb(req),
          "StructureNode",
          "reorder",
          {
            parent_id:
              body.parentId === null ? null : String(body.parentId),
            ordered_ids: orderedIds,
          },
          kernelContext(req)
        );
        return res.json({ ok: true });
      }
      const kind = body.kind as ReorderKind;
      if (kind !== "department" && kind !== "division" && kind !== "page") {
        return res.status(400).json({ error: "invalid kind" });
      }
      const departmentId =
        typeof body.departmentId === "string" ? body.departmentId : undefined;
      const divisionId =
        typeof body.divisionId === "string" ? body.divisionId : undefined;
      const parentId =
        kind === "department"
          ? null
          : kind === "division"
            ? departmentId
            : departmentId && divisionId
              ? `${departmentId}-${divisionId}`
              : undefined;
      if (parentId === undefined) {
        return res.status(400).json({ error: "parent scope required" });
      }
      const normalizedIds =
        kind === "department"
          ? orderedIds
          : orderedIds.map((id) =>
              id.startsWith(`${parentId}-`) ? id : `${parentId}-${id}`
            );
      await executeCollectionAction(
        tdb(req),
        "StructureNode",
        "reorder",
        { parent_id: parentId, ordered_ids: normalizedIds },
        kernelContext(req)
      );
      res.json({ ok: true });
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
