/**
 * Human Coding workspace REST API over sandboxed fs-tools (#147).
 */
import { Router, type Request, type Response } from "express";
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
  writeFile as writeCodingFile,
} from "../services/coding/fs-tools.js";
import { logToolAudit } from "../services/coding/tool-audit.js";
import { runTerminal } from "../services/coding/terminal-service.js";

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

/** Mounted at `/coding` under the AI router (`/api/ai/coding/*`). */
export function createCodingWorkspaceRouter(
  tdb: (req: Request) => AppDatabase
): Router {
  const router = Router();

  router.get("/tree", (req, res) => {
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

  router.get("/file", (req, res) => {
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

  router.put("/file", (req, res) => {
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
      const result = writeCodingFile({ path, content, tenantId, root });
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

  router.post("/file", (req, res) => {
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
      const result = writeCodingFile({ path, content, tenantId, root });
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

  router.post("/mkdir", (req, res) => {
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

  router.post("/rename", (req, res) => {
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

  router.delete("/file", (req, res) => {
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

  /**
   * Human coding terminal command runner (#148 slice 1).
   * One-shot sandboxed shell via the same runTerminal / bwrap path as agent tools.
   * Not a PTY: stdin is ignored; full interactive shell is a follow-up.
   */
  router.post("/terminal/run", async (req, res) => {
    if (denyIfBlocked(res)) return;
    const db = tdb(req);
    const { tenantId, root, agentId } = fsOpts(req, db);
    const body = req.body as {
      command?: string;
      cwd?: string;
      timeoutMs?: number;
    };
    const command = String(body.command ?? "").trim();
    if (!command) {
      res.status(400).json({ error: "command required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const abortController = new AbortController();
    const onClientClose = () => abortController.abort();
    req.on("close", onClientClose);
    res.on("close", onClientClose);

    try {
      const result = await runTerminal({
        command,
        cwd: body.cwd?.trim() || ".",
        timeoutMs: body.timeoutMs,
        tenantId,
        root,
        abortSignal: abortController.signal,
        onOutput: (chunk) => {
          send("output", {
            stream: chunk.stream,
            text: chunk.text,
          });
        },
      });
      logToolAudit(db, {
        agentId,
        userId: req.user?.id,
        action: "ui_run_terminal",
        cwd: result.cwd,
        command: result.command,
        exitCode: result.exitCode,
        result: result.timedOut
          ? "timeout"
          : result.exitCode === 0
            ? "ok"
            : "error",
      });
      send("done", {
        exitCode: result.exitCode,
        signal: result.signal,
        cwd: result.cwd,
        timedOut: result.timedOut,
        sandboxed: result.sandboxed ?? false,
        netMode: result.netMode ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logToolAudit(db, {
        agentId,
        userId: req.user?.id,
        action: "ui_run_terminal",
        command,
        result: `error:${msg.slice(0, 200)}`,
      });
      send("error", { error: msg });
    } finally {
      req.off("close", onClientClose);
      res.off("close", onClientClose);
      if (!res.writableEnded) res.end();
    }
  });

  return router;
}
