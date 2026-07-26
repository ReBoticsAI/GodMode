/**
 * Human Coding workspace REST API over sandboxed fs-tools (#147).
 */
import type { Request, Response, Router } from "express";
import fs from "node:fs";
import type { AppDatabase } from "../db.js";
import { getAgent } from "../services/agents/agents-db.js";
import { codingUiAllowed } from "../services/coding/coding-ui-access.js";
import {
  deletePath,
  listDir,
  mkdirPath,
  readFileRaw,
  renamePath,
  resolveCodingRoot,
  resolveRepoPath,
  writeFile,
} from "../services/coding/fs-tools.js";
import { logToolAudit } from "../services/coding/tool-audit.js";

const MAX_UI_FILE_BYTES = 512 * 1024;

function agentIdFrom(req: Request): string {
  const body = req.body as { agentId?: string } | undefined;
  return String(req.query.agentId ?? body?.agentId ?? "intelligence");
}

function agentWorkspaceFrom(
  db: AppDatabase,
  agentId: string
): string | undefined {
  const agent = getAgent(db, agentId);
  const ws =
    agent?.config &&
    typeof (agent.config as { workspace?: unknown }).workspace === "string"
      ? String((agent.config as { workspace: string }).workspace).trim()
      : "";
  return ws || undefined;
}

function fsOpts(req: Request, db: AppDatabase) {
  const agentId = agentIdFrom(req);
  return {
    tenantId: req.tenantId,
    root: agentWorkspaceFrom(db, agentId),
    agentId,
  };
}

function denyIfBlocked(res: Response): boolean {
  if (!codingUiAllowed()) {
    res.status(403).json({
      error:
        "Coding workspace is disabled for this installation (SaaS code access off).",
      codingDisabled: true,
    });
    return true;
  }
  return false;
}

function sendFsError(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const status = /escapes|not found|not a |already exists|not empty|required/i.test(
    msg
  )
    ? 400
    : 500;
  res.status(status).json({ error: msg });
}

function pathExists(
  rel: string,
  opts: { tenantId?: string | null; root?: string }
): boolean {
  try {
    return fs.existsSync(resolveRepoPath(rel, opts));
  } catch {
    return false;
  }
}

export function registerCodingWorkspaceRoutes(
  router: Router,
  tdb: (req: Request) => AppDatabase
): void {
  router.get("/coding/tree", (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const db = tdb(req);
      const { tenantId, root } = fsOpts(req, db);
      const path = String(req.query.path ?? ".").trim() || ".";
      const result = listDir({
        path,
        recursive: false,
        tenantId,
        root,
      });
      const base =
        path === "." ? "" : path.replace(/\\/g, "/").replace(/\/$/, "");
      const entries = result.entries.map((e) => {
        const full = e.name.replace(/\\/g, "/");
        const name =
          base && full.startsWith(`${base}/`)
            ? full.slice(base.length + 1)
            : full;
        return { name, path: full, type: e.type };
      });
      res.json({
        path: result.path,
        root: resolveCodingRoot({ tenantId, root }),
        entries,
      });
    } catch (err) {
      sendFsError(res, err);
    }
  });

  router.get("/coding/file", (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const db = tdb(req);
      const { tenantId, root } = fsOpts(req, db);
      const path = String(req.query.path ?? "").trim();
      if (!path) {
        res.status(400).json({ error: "path required" });
        return;
      }
      if (!pathExists(path, { tenantId, root })) {
        res.status(404).json({ error: `File not found: ${path}` });
        return;
      }
      const content = readFileRaw({ path, tenantId, root });
      if (Buffer.byteLength(content, "utf8") > MAX_UI_FILE_BYTES) {
        res.status(413).json({
          error: `File exceeds ${MAX_UI_FILE_BYTES} byte UI limit`,
        });
        return;
      }
      res.json({ path, content });
    } catch (err) {
      sendFsError(res, err);
    }
  });

  router.put("/coding/file", (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const db = tdb(req);
      const { tenantId, root, agentId } = fsOpts(req, db);
      const body = req.body as { path?: string; content?: string };
      const path = String(body.path ?? "").trim();
      if (!path) {
        res.status(400).json({ error: "path required" });
        return;
      }
      const content = String(body.content ?? "");
      if (Buffer.byteLength(content, "utf8") > MAX_UI_FILE_BYTES) {
        res.status(413).json({
          error: `File exceeds ${MAX_UI_FILE_BYTES} byte UI limit`,
        });
        return;
      }
      const result = writeFile({ path, content, tenantId, root });
      logToolAudit(db, {
        agentId,
        userId: req.user?.id,
        action: "ui_write_file",
        path,
        bytesOut: result.bytes,
        result: result.created ? "created" : "updated",
      });
      res.json(result);
    } catch (err) {
      sendFsError(res, err);
    }
  });

  router.post("/coding/file", (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const db = tdb(req);
      const { tenantId, root, agentId } = fsOpts(req, db);
      const body = req.body as { path?: string; content?: string };
      const path = String(body.path ?? "").trim();
      if (!path) {
        res.status(400).json({ error: "path required" });
        return;
      }
      if (pathExists(path, { tenantId, root })) {
        res.status(409).json({ error: `Already exists: ${path}` });
        return;
      }
      const content = String(body.content ?? "");
      if (Buffer.byteLength(content, "utf8") > MAX_UI_FILE_BYTES) {
        res.status(413).json({
          error: `File exceeds ${MAX_UI_FILE_BYTES} byte UI limit`,
        });
        return;
      }
      const result = writeFile({ path, content, tenantId, root });
      logToolAudit(db, {
        agentId,
        userId: req.user?.id,
        action: "ui_create_file",
        path,
        bytesOut: result.bytes,
        result: "created",
      });
      res.status(201).json(result);
    } catch (err) {
      sendFsError(res, err);
    }
  });

  router.post("/coding/mkdir", (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const db = tdb(req);
      const { tenantId, root, agentId } = fsOpts(req, db);
      const body = req.body as { path?: string };
      const path = String(body.path ?? "").trim();
      if (!path) {
        res.status(400).json({ error: "path required" });
        return;
      }
      const result = mkdirPath({ path, tenantId, root });
      logToolAudit(db, {
        agentId,
        userId: req.user?.id,
        action: "ui_mkdir",
        path,
        result: result.created ? "created" : "exists",
      });
      res.json(result);
    } catch (err) {
      sendFsError(res, err);
    }
  });

  router.post("/coding/rename", (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const db = tdb(req);
      const { tenantId, root, agentId } = fsOpts(req, db);
      const body = req.body as { from?: string; to?: string };
      const from = String(body.from ?? "").trim();
      const to = String(body.to ?? "").trim();
      if (!from || !to) {
        res.status(400).json({ error: "from and to required" });
        return;
      }
      const result = renamePath({ from, to, tenantId, root });
      logToolAudit(db, {
        agentId,
        userId: req.user?.id,
        action: "ui_rename",
        path: `${from} -> ${to}`,
        result: "ok",
      });
      res.json(result);
    } catch (err) {
      sendFsError(res, err);
    }
  });

  router.delete("/coding/file", (req, res) => {
    if (denyIfBlocked(res)) return;
    try {
      const db = tdb(req);
      const { tenantId, root, agentId } = fsOpts(req, db);
      const path = String(req.query.path ?? "").trim();
      if (!path) {
        res.status(400).json({ error: "path required" });
        return;
      }
      const result = deletePath({ path, tenantId, root });
      logToolAudit(db, {
        agentId,
        userId: req.user?.id,
        action: "ui_delete",
        path,
        result: result.deleted ? result.type : "missing",
      });
      res.json(result);
    } catch (err) {
      sendFsError(res, err);
    }
  });
}
