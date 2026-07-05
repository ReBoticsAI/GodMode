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
  createDepartment,
  createDivision,
  createNode,
  createPage,
  deleteDepartment,
  deleteDivision,
  deleteNode,
  deletePage,
  readStructure,
  reorder,
  reorderNodes,
  setNodeAgent,
  StructureError,
  updateDepartment,
  updateDivision,
  updateNode,
  updatePage,
  type ReorderKind,
} from "../services/structure.js";
import {
  readStructureGraphRecord,
  writeStructureGraphLayout,
} from "../services/structure-graph-service.js";
import { requireTenantRole } from "../services/auth/middleware.js";

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
    if (err instanceof StructureError) {
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
      const dept = createDepartment(tdb(req), req.body ?? {});
      deps.bus?.emit("structure.department.created", {
        departmentId: dept.id,
        label: dept.label,
        icon: dept.icon,
      });
      res.json(dept);
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.put("/departments/:id", (req, res) => {
    try {
      updateDepartment(tdb(req), req.params.id, req.body ?? {});
      deps.bus?.emit("structure.department.updated", { departmentId: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/departments/:id", (req, res) => {
    try {
      deleteDepartment(tdb(req), req.params.id);
      deps.bus?.emit("structure.department.deleted", { departmentId: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/departments/:dept/divisions", (req, res) => {
    try {
      const div = createDivision(tdb(req), req.params.dept, req.body ?? {});
      deps.bus?.emit("structure.division.created", {
        departmentId: req.params.dept,
        divisionId: div.id,
      });
      res.json(div);
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.put("/divisions/:dept/:id", (req, res) => {
    try {
      updateDivision(tdb(req), req.params.dept, req.params.id, req.body ?? {});
      deps.bus?.emit("structure.division.updated", {
        departmentId: req.params.dept,
        divisionId: req.params.id,
      });
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/divisions/:dept/:id", (req, res) => {
    try {
      deleteDivision(tdb(req), req.params.dept, req.params.id);
      deps.bus?.emit("structure.division.deleted", {
        departmentId: req.params.dept,
        divisionId: req.params.id,
      });
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/divisions/:dept/:div/pages", (req, res) => {
    try {
      const page = createPage(
        tdb(req),
        req.params.dept,
        req.params.div,
        req.body ?? {}
      );
      deps.bus?.emit("structure.page.created", {
        departmentId: req.params.dept,
        divisionId: req.params.div,
        pageId: page.id,
      });
      res.json(page);
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.put("/pages/:dept/:div/:id", (req, res) => {
    try {
      updatePage(
        tdb(req),
        req.params.dept,
        req.params.div,
        req.params.id,
        req.body ?? {}
      );
      deps.bus?.emit("structure.page.updated", {
        departmentId: req.params.dept,
        divisionId: req.params.div,
        pageId: req.params.id,
      });
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/pages/:dept/:div/:id", (req, res) => {
    try {
      deletePage(tdb(req), req.params.dept, req.params.div, req.params.id);
      deps.bus?.emit("structure.page.deleted", {
        departmentId: req.params.dept,
        divisionId: req.params.div,
        pageId: req.params.id,
      });
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/nodes", (req, res) => {
    try {
      const body = req.body ?? {};
      const node = createNode(tdb(req), {
        id: String(body.id ?? ""),
        parentId:
          body.parentId === null || body.parentId === undefined
            ? null
            : String(body.parentId),
        label: String(body.label ?? ""),
        icon: String(body.icon ?? ""),
        segment: body.segment != null ? String(body.segment) : undefined,
        kind: body.kind != null ? String(body.kind) : undefined,
        rightSidebar:
          body.rightSidebar != null ? String(body.rightSidebar) : undefined,
      });
      deps.bus?.emit("structure.node.created", { nodeId: node.id });
      res.json(node);
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.put("/nodes/:id", (req, res) => {
    try {
      updateNode(tdb(req), req.params.id, req.body ?? {});
      deps.bus?.emit("structure.node.updated", { nodeId: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/nodes/:id", (req, res) => {
    try {
      deleteNode(tdb(req), req.params.id);
      deps.bus?.emit("structure.node.deleted", { nodeId: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/nodes/:id/agent", (req, res) => {
    try {
      const agentId =
        req.body?.agentId === null || req.body?.agentId === undefined
          ? null
          : String(req.body.agentId);
      setNodeAgent(tdb(req), req.params.id, agentId);
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.delete("/nodes/:id/agent", (req, res) => {
    try {
      setNodeAgent(tdb(req), req.params.id, null);
      res.json({ ok: true });
    } catch (err) {
      handleStructureError(err, res);
    }
  });

  router.post("/structure/reorder", (req, res) => {
    try {
      const body = req.body ?? {};
      const orderedIds = Array.isArray(body.orderedIds)
        ? (body.orderedIds as string[])
        : [];
      if (typeof body.parentId === "string" || body.parentId === null) {
        reorderNodes(
          tdb(req),
          body.parentId === null ? null : String(body.parentId),
          orderedIds
        );
        deps.bus?.emit("structure.changed", { kind: "reorder" });
        return res.json({ ok: true });
      }
      const kind = body.kind as ReorderKind;
      if (kind !== "department" && kind !== "division" && kind !== "page") {
        return res.status(400).json({ error: "invalid kind" });
      }
      reorder(
        tdb(req),
        kind,
        {
          departmentId:
            typeof body.departmentId === "string" ? body.departmentId : undefined,
          divisionId:
            typeof body.divisionId === "string" ? body.divisionId : undefined,
        },
        orderedIds
      );
      deps.bus?.emit("structure.reordered", { kind });
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
