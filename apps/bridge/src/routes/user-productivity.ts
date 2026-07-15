import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
  requireEditorForMutation,
} from "../services/auth/middleware.js";
import {
  ensureUserProject,
  newId,
  requireWriteAccess,
  resolveUserCalendarAccess,
  resolveUserTasksAccess,
} from "../services/user-productivity.js";
import type { ShareError } from "../services/share-service.js";

const CALENDAR_KINDS = new Set(["event", "task", "appointment"]);

function handleShareError(err: unknown, res: Response): boolean {
  const e = err as ShareError & { status?: number };
  if (e?.status) {
    res.status(e.status).json({ error: e.message });
    return true;
  }
  return false;
}

export function createUserProductivityRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant, requireEditorForMutation);

  // --- Calendar ---

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
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  router.get("/calendar/activity", (req, res) => {
    try {
      const access = resolveUserCalendarAccess(req, "viewer");
      const from = req.query.from ? String(req.query.from) : undefined;
      const to = req.query.to ? String(req.query.to) : undefined;
      const pid = ensureUserProject(access.ownerUserId, access.db);

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
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  // --- Tasks / Projects ---

  router.get("/projects", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "viewer");
      const pid = ensureUserProject(access.ownerUserId, access.db);
      const projects = access.db
        .prepare(`SELECT * FROM ai_projects WHERE user_id = ? ORDER BY updated_at DESC`)
        .all(access.ownerUserId);
      // Columns are the shared canonical kanban lanes (backlog/in_progress/
      // review/done), keyed by a global primary key. They are seeded once for
      // the 'default' project, so a per-project filter returns nothing for user
      // boards. Mirror the agent board and return the canonical set so the user
      // Tasks board renders the full Kanban (cards map to lanes by column_id).
      const columns = access.db
        .prepare(`SELECT * FROM ai_project_columns ORDER BY sort_order ASC`)
        .all();
      const cards = access.db
        .prepare(
          `SELECT * FROM ai_project_cards WHERE project_id = ? ORDER BY sort_order ASC`
        )
        .all(pid);
      res.json({
        projects,
        columns,
        cards,
        role: access.role,
        ownerUserId: access.ownerUserId,
      });
    } catch (err) {
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  router.get("/projects/cards/:id/subtasks", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "viewer");
      const pid = ensureUserProject(access.ownerUserId, access.db);
      const parent = access.db
        .prepare(`SELECT id FROM ai_project_cards WHERE id=? AND project_id=?`)
        .get(req.params.id, pid);
      if (!parent) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const rows = access.db
        .prepare(
          `SELECT * FROM ai_project_cards WHERE parent_card_id = ? AND project_id = ? ORDER BY sort_order ASC`
        )
        .all(req.params.id, pid) as Array<{ column_id: string; status: string | null }>;
      const total = rows.length;
      const done = rows.filter(
        (r) => r.column_id === "done" || r.status === "accepted"
      ).length;
      res.json({ subtasks: rows, total, done, open: total - done });
    } catch (err) {
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  router.get("/projects/cards/:id/comments", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "viewer");
      const pid = ensureUserProject(access.ownerUserId, access.db);
      const card = access.db
        .prepare(`SELECT id FROM ai_project_cards WHERE id=? AND project_id=?`)
        .get(req.params.id, pid);
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
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  return router;
}
