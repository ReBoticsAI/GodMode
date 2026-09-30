import { Router } from "express";
import { requireAuth } from "../services/auth/middleware.js";
import {
  SQLITE_UNIVERSE_MAX_OPEN,
  ensureAgentUniverseFile,
  ensureChatUniverseFile,
  ensureSurfaceUniverseFile,
  ensureVaultUniverseFiles,
  listUniverseEntries,
  listUniverseManifest,
  prepareOpenSet,
  sqliteUniverseRoot,
} from "../services/sqlite-universe-registry.js";
import {
  listSqliteUniverseTool,
  querySqliteUniverseTool,
} from "../services/sqlite-universe-tools.js";

/**
 * SQLite-universe open-set + registry API (Phases 2–6 pilots).
 */
export function createSqliteUniverseRouter(): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.json({
      root: sqliteUniverseRoot(),
      maxOpen: SQLITE_UNIVERSE_MAX_OPEN,
      entryCount: listUniverseEntries().length,
    });
  });

  router.get("/entries", requireAuth, (req, res) => {
    const ownerKind =
      typeof req.query.ownerKind === "string" ? req.query.ownerKind : undefined;
    const ownerId =
      typeof req.query.ownerId === "string" ? req.query.ownerId : undefined;
    res.json({
      entries: listUniverseEntries(
        ownerKind && ownerId ? { ownerKind, ownerId } : undefined
      ),
    });
  });

  router.get("/manifest", requireAuth, (_req, res) => {
    res.json({ files: listUniverseManifest() });
  });

  router.post("/open", requireAuth, (req, res) => {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    if (!paths.every((p: unknown) => typeof p === "string")) {
      res.status(400).json({ error: "paths must be string[]" });
      return;
    }
    const result = prepareOpenSet(paths as string[]);
    res
      .status(result.rejected.length && !result.opened.length ? 400 : 200)
      .json({
        maxOpen: SQLITE_UNIVERSE_MAX_OPEN,
        ...result,
      });
  });

  router.post("/pilot/chat", requireAuth, (req, res) => {
    const chatId = String(req.body?.chatId ?? "").trim();
    const ownerAgentId = String(
      req.body?.ownerAgentId ?? "intelligence"
    ).trim();
    const label =
      typeof req.body?.label === "string" ? req.body.label : undefined;
    if (!chatId) {
      res.status(400).json({ error: "chatId required" });
      return;
    }
    try {
      const file = ensureChatUniverseFile({ chatId, ownerAgentId, label });
      res.json({ ok: true, ...file });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "pilot chat failed",
      });
    }
  });

  router.post("/pilot/agent", requireAuth, (req, res) => {
    const agentId = String(req.body?.agentId ?? "").trim();
    const label =
      typeof req.body?.label === "string" ? req.body.label : undefined;
    const ownerUserId =
      typeof req.body?.ownerUserId === "string"
        ? req.body.ownerUserId
        : req.user?.id;
    if (!agentId) {
      res.status(400).json({ error: "agentId required" });
      return;
    }
    try {
      const file = ensureAgentUniverseFile({
        agentId,
        ownerUserId,
        label,
      });
      res.json({ ok: true, ...file });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "pilot agent failed",
      });
    }
  });

  router.post("/pilot/vaults", requireAuth, (req, res) => {
    const userId = String(req.body?.userId ?? req.user?.id ?? "").trim();
    if (!userId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    try {
      res.json({ ok: true, ...ensureVaultUniverseFiles({ userId }) });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "vault pilot failed",
      });
    }
  });

  router.post("/pilot/surface", requireAuth, (req, res) => {
    const kind = String(req.body?.kind ?? "").trim() as
      | "structure"
      | "knowledge"
      | "automations"
      | "calendar";
    const id = String(req.body?.id ?? "default").trim();
    if (!["structure", "knowledge", "automations", "calendar"].includes(kind)) {
      res.status(400).json({ error: "invalid kind" });
      return;
    }
    try {
      const file = ensureSurfaceUniverseFile({
        kind,
        id,
        ownerUserId: req.user?.id,
        ownerAgentId: "intelligence",
      });
      res.json({ ok: true, ...file });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "surface pilot failed",
      });
    }
  });

  router.post("/tools/list", requireAuth, (_req, res) => {
    res.json(listSqliteUniverseTool());
  });

  router.post("/tools/query", requireAuth, (req, res) => {
    try {
      const relativePath = String(req.body?.relativePath ?? "").trim();
      const sql = String(req.body?.sql ?? "").trim();
      if (!relativePath || !sql) {
        res.status(400).json({ error: "relativePath and sql required" });
        return;
      }
      res.json(
        querySqliteUniverseTool({
          relativePath,
          sql,
          params: Array.isArray(req.body?.params) ? req.body.params : undefined,
        })
      );
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "query failed",
      });
    }
  });

  return router;
}
