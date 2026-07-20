import { Router, type Request, type Response } from "express";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
  requireEditorForMutation,
} from "../services/auth/middleware.js";
import {
  archiveUserBoard,
  createUserBoard,
  listUserBoards,
  renameUserBoard,
  requireWriteAccess,
  resolveUserBoardId,
  resolveUserCalendarAccess,
  resolveUserTasksAccess,
} from "../services/user-productivity.js";
import type { ShareError } from "../services/share-service.js";
import {
  linkBoardToGithubProject,
  listGithubProjectsForUser,
  syncBoardWithGithub,
  updateBoardStatusMap,
  getGithubProjectMetaForUser,
  unlinkBoardGithub,
} from "../services/github-projects.js";

function handleShareError(err: unknown, res: Response): boolean {
  const e = err as ShareError & { status?: number };
  if (e?.status) {
    res.status(e.status).json({ error: e.message });
    return true;
  }
  return false;
}

function sendErr(err: unknown, res: Response): void {
  if (handleShareError(err, res)) return;
  const e = err as { status?: number; message?: string };
  res.status(e?.status ?? 500).json({ error: e?.message ?? String(err) });
}

function parseProjectId(req: Request): string | undefined {
  const q = req.query.projectId;
  if (typeof q === "string" && q.trim()) return q.trim();
  const body = req.body?.projectId ?? req.body?.project_id;
  if (typeof body === "string" && body.trim()) return body.trim();
  return undefined;
}

export function createUserProductivityRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant, requireEditorForMutation);

  router.get("/calendar/events", (req, res) => {
    try {
      const access = resolveUserCalendarAccess(req, "viewer");
      const from = req.query.from ? String(req.query.from) : undefined;
      const to = req.query.to ? String(req.query.to) : undefined;
      const clauses: string[] = ["user_id = ?"];
      const params: unknown[] = [access.ownerUserId];
      if (from) {
        clauses.push("start_at >= ?");
        params.push(from);
      }
      if (to) {
        clauses.push("start_at <= ?");
        params.push(to);
      }
      const events = access.db
        .prepare(
          `SELECT * FROM ai_calendar_events WHERE ${clauses.join(" AND ")} ORDER BY start_at ASC`
        )
        .all(...params);
      res.json({ events, role: access.role, ownerUserId: access.ownerUserId });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.get("/calendar/activity", (req, res) => {
    try {
      const access = resolveUserCalendarAccess(req, "viewer");
      const from = req.query.from ? String(req.query.from) : undefined;
      const to = req.query.to ? String(req.query.to) : undefined;
      const pid = resolveUserBoardId(
        access.ownerUserId,
        access.db,
        parseProjectId(req)
      );

      const cardClauses: string[] = ["project_id = ?", "due_at IS NOT NULL"];
      const cardParams: unknown[] = [pid];
      if (from) {
        cardClauses.push("due_at >= ?");
        cardParams.push(from);
      }
      if (to) {
        cardClauses.push("due_at <= ?");
        cardParams.push(to);
      }
      const cards = access.db
        .prepare(
          `SELECT * FROM ai_project_cards WHERE ${cardClauses.join(" AND ")} ORDER BY due_at ASC LIMIT 500`
        )
        .all(...cardParams);

      res.json({ runs: [], cards, role: access.role, ownerUserId: access.ownerUserId });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.get("/projects", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "viewer");
      const boards = listUserBoards(access.ownerUserId, access.db);
      const pid = resolveUserBoardId(
        access.ownerUserId,
        access.db,
        parseProjectId(req)
      );
      const columns = access.db
        .prepare(`SELECT * FROM ai_project_columns ORDER BY sort_order ASC`)
        .all();
      const cards = access.db
        .prepare(
          `SELECT * FROM ai_project_cards WHERE project_id = ? ORDER BY sort_order ASC`
        )
        .all(pid);
      res.json({
        projects: boards,
        activeProjectId: pid,
        columns,
        cards,
        role: access.role,
        ownerUserId: access.ownerUserId,
      });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.post("/projects", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      const board = createUserBoard(access.ownerUserId, access.db, name);
      res.status(201).json({ project: board });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.patch("/projects/:id", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const boardId = String(req.params.id);
      if (typeof req.body?.name === "string") {
        const board = renameUserBoard(
          access.ownerUserId,
          access.db,
          boardId,
          req.body.name
        );
        res.json({ project: board });
        return;
      }
      res.status(400).json({ error: "name required" });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.post("/projects/:id/archive", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const board = archiveUserBoard(
        access.ownerUserId,
        access.db,
        String(req.params.id)
      );
      res.json({ project: board });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.post("/projects/:id/github/link", async (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const projectNodeId =
        typeof req.body?.projectNodeId === "string"
          ? req.body.projectNodeId.trim()
          : "";
      const statusMap =
        req.body?.statusMap && typeof req.body.statusMap === "object"
          ? (req.body.statusMap as Record<string, string>)
          : undefined;
      const board = await linkBoardToGithubProject({
        userId: access.ownerUserId,
        db: access.db,
        boardId: String(req.params.id),
        projectNodeId,
        statusMap,
      });
      res.json({ project: board });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.post("/projects/:id/github/unlink", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const board = unlinkBoardGithub(
        access.ownerUserId,
        access.db,
        String(req.params.id)
      );
      res.json({ project: board });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.post("/projects/:id/github/sync", async (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const result = await syncBoardWithGithub({
        userId: access.ownerUserId,
        db: access.db,
        boardId: String(req.params.id),
      });
      res.json(result);
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.post("/projects/:id/github/status-map", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const statusMap =
        req.body?.statusMap && typeof req.body.statusMap === "object"
          ? (req.body.statusMap as Record<string, string>)
          : null;
      if (!statusMap) {
        res.status(400).json({ error: "statusMap required" });
        return;
      }
      const board = updateBoardStatusMap(
        access.ownerUserId,
        access.db,
        String(req.params.id),
        statusMap
      );
      res.json({ project: board });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.get("/github/projects", async (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "viewer");
      const projects = await listGithubProjectsForUser(
        access.ownerUserId,
        access.db
      );
      res.json({ projects });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.get("/github/projects/meta", async (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "viewer");
      const projectNodeId =
        typeof req.query.projectNodeId === "string"
          ? req.query.projectNodeId.trim()
          : "";
      if (!projectNodeId) {
        res.status(400).json({ error: "projectNodeId required" });
        return;
      }
      const meta = await getGithubProjectMetaForUser(
        access.ownerUserId,
        access.db,
        projectNodeId
      );
      res.json(meta);
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.get("/projects/cards/:id/subtasks", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "viewer");
      const card = access.db
        .prepare(
          `SELECT c.id, c.project_id FROM ai_project_cards c
           JOIN ai_projects p ON p.id = c.project_id
           WHERE c.id=? AND p.user_id=?`
        )
        .get(req.params.id, access.ownerUserId) as
        | { id: string; project_id: string }
        | undefined;
      if (!card) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const rows = access.db
        .prepare(
          `SELECT * FROM ai_project_cards WHERE parent_card_id = ? AND project_id = ? ORDER BY sort_order ASC`
        )
        .all(req.params.id, card.project_id) as Array<{
        column_id: string;
        status: string | null;
      }>;
      const total = rows.length;
      const done = rows.filter(
        (r) => r.column_id === "done" || r.status === "accepted"
      ).length;
      res.json({ subtasks: rows, total, done, open: total - done });
    } catch (err) {
      sendErr(err, res);
    }
  });

  router.get("/projects/cards/:id/comments", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "viewer");
      const card = access.db
        .prepare(
          `SELECT c.id FROM ai_project_cards c
           JOIN ai_projects p ON p.id = c.project_id
           WHERE c.id=? AND p.user_id=?`
        )
        .get(req.params.id, access.ownerUserId);
      if (!card) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const rows = access.db
        .prepare(
          `SELECT id, card_id, author, body, kind, created_at FROM ai_card_comments
           WHERE card_id = ? ORDER BY created_at ASC`
        )
        .all(req.params.id);
      res.json({ comments: rows });
    } catch (err) {
      sendErr(err, res);
    }
  });

  return router;
}
