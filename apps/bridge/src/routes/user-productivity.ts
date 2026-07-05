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

  router.post("/calendar/events", (req, res) => {
    try {
      const access = resolveUserCalendarAccess(req, "editor");
      requireWriteAccess(access);
      const {
        kind,
        title,
        description,
        start_at,
        end_at,
        all_day,
        location,
        linked_card_id,
        linked_run_id,
        status,
      } = req.body ?? {};
      if (!title || !String(title).trim() || !start_at || !String(start_at).trim()) {
        res.status(400).json({ error: "title and start_at required" });
        return;
      }
      const id = uuidv4();
      const k = CALENDAR_KINDS.has(String(kind)) ? String(kind) : "event";
      access.db.prepare(
        `INSERT INTO ai_calendar_events
           (id, agent_id, user_id, kind, title, description, start_at, end_at, all_day, location, linked_card_id, linked_run_id, status)
         VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        access.ownerUserId,
        k,
        String(title),
        description ?? null,
        String(start_at),
        end_at ?? null,
        all_day ? 1 : 0,
        location ?? null,
        linked_card_id ?? null,
        linked_run_id ?? null,
        status ? String(status) : "scheduled"
      );
      res
        .status(201)
        .json(access.db.prepare(`SELECT * FROM ai_calendar_events WHERE id = ?`).get(id));
    } catch (err) {
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  router.patch("/calendar/events/:id", (req, res) => {
    try {
      const access = resolveUserCalendarAccess(req, "editor");
      requireWriteAccess(access);
      const row = access.db
        .prepare(`SELECT id FROM ai_calendar_events WHERE id=? AND user_id=?`)
        .get(req.params.id, access.ownerUserId);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const { title, description, start_at, end_at, all_day, location, kind, status } =
        req.body ?? {};
      if (title != null) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET title = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(title), req.params.id);
      }
      if (description !== undefined) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET description = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(description === null ? null : String(description), req.params.id);
      }
      if (start_at != null) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET start_at = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(start_at), req.params.id);
      }
      if (end_at !== undefined) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET end_at = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(end_at === null ? null : String(end_at), req.params.id);
      }
      if (all_day != null) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET all_day = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(all_day ? 1 : 0, req.params.id);
      }
      if (location !== undefined) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET location = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(location === null ? null : String(location), req.params.id);
      }
      if (kind != null && CALENDAR_KINDS.has(String(kind))) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET kind = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(kind), req.params.id);
      }
      if (status != null) {
        access.db.prepare(
          `UPDATE ai_calendar_events SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(status), req.params.id);
      }
      res.json(
        access.db.prepare(`SELECT * FROM ai_calendar_events WHERE id = ?`).get(req.params.id)
      );
    } catch (err) {
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  router.delete("/calendar/events/:id", (req, res) => {
    try {
      const access = resolveUserCalendarAccess(req, "editor");
      requireWriteAccess(access);
      const r = access.db
        .prepare(`DELETE FROM ai_calendar_events WHERE id=? AND user_id=?`)
        .run(req.params.id, access.ownerUserId);
      res.json({ ok: r.changes > 0 });
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

  router.post("/projects/cards", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const id = newId();
      const {
        columnId,
        title,
        description,
        prompt,
        contextJson,
        tags,
        dueAt,
        linkedChatId,
        linkedWorkflowId,
        priority,
        parentCardId,
        status,
        assignedAgentId,
      } = req.body ?? {};
      const pid = ensureUserProject(access.ownerUserId, access.db);
      let resolvedPid = pid;
      if (parentCardId != null) {
        const parent = access.db
          .prepare(`SELECT project_id FROM ai_project_cards WHERE id = ? AND project_id = ?`)
          .get(String(parentCardId), pid) as { project_id: string } | undefined;
        resolvedPid = parent?.project_id ?? pid;
      }
      const cid = String(columnId ?? "backlog");
      const ctx =
        contextJson == null
          ? null
          : typeof contextJson === "string"
            ? contextJson
            : JSON.stringify(contextJson);
      const maxOrder = access.db
        .prepare(`SELECT COALESCE(MAX(sort_order), -1) as m FROM ai_project_cards WHERE column_id = ? AND project_id = ?`)
        .get(cid, resolvedPid) as { m: number };
      access.db.prepare(
        `INSERT INTO ai_project_cards (id, project_id, column_id, title, description, prompt, context_json, tags_json, due_at, linked_chat_id, linked_workflow_id, priority, parent_card_id, status, assigned_agent_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        resolvedPid,
        cid,
        String(title ?? "Untitled"),
        description ?? null,
        prompt ?? null,
        ctx,
        tags ?? null,
        dueAt ?? null,
        linkedChatId ?? null,
        linkedWorkflowId ?? null,
        priority != null ? Number(priority) : 2,
        parentCardId ?? null,
        status ?? null,
        assignedAgentId ?? null,
        maxOrder.m + 1
      );
      res
        .status(201)
        .json(access.db.prepare(`SELECT * FROM ai_project_cards WHERE id = ?`).get(id));
    } catch (err) {
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  router.patch("/projects/cards/:id", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const pid = ensureUserProject(access.ownerUserId, access.db);
      const owned = access.db
        .prepare(`SELECT id FROM ai_project_cards WHERE id=? AND project_id=?`)
        .get(req.params.id, pid);
      if (!owned) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const {
        columnId,
        sortOrder,
        title,
        description,
        prompt,
        contextJson,
        tags,
        dueAt,
        linkedChatId,
        linkedWorkflowId,
        priority,
        parentCardId,
        status,
        assignedAgentId,
      } = req.body ?? {};
      const patch = access.db;
      if (priority != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET priority = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(Number(priority), req.params.id);
      }
      if (parentCardId !== undefined) {
        patch.prepare(
          `UPDATE ai_project_cards SET parent_card_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(parentCardId === null ? null : String(parentCardId), req.params.id);
      }
      if (status != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(status), req.params.id);
      }
      if (columnId != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET column_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(columnId), req.params.id);
      }
      if (sortOrder != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(Number(sortOrder), req.params.id);
      }
      if (title != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET title = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(title), req.params.id);
      }
      if (description != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET description = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(description), req.params.id);
      }
      if (prompt != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET prompt = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(prompt), req.params.id);
      }
      if (contextJson != null) {
        const ctx =
          typeof contextJson === "string" ? contextJson : JSON.stringify(contextJson);
        patch.prepare(
          `UPDATE ai_project_cards SET context_json = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(ctx, req.params.id);
      }
      if (tags != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET tags_json = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(tags), req.params.id);
      }
      if (dueAt != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET due_at = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(dueAt), req.params.id);
      }
      if (linkedChatId != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET linked_chat_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(linkedChatId), req.params.id);
      }
      if (linkedWorkflowId != null) {
        patch.prepare(
          `UPDATE ai_project_cards SET linked_workflow_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(String(linkedWorkflowId), req.params.id);
      }
      if (assignedAgentId !== undefined) {
        patch.prepare(
          `UPDATE ai_project_cards SET assigned_agent_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(assignedAgentId === null ? null : String(assignedAgentId), req.params.id);
      }
      res.json(
        patch.prepare(`SELECT * FROM ai_project_cards WHERE id = ?`).get(req.params.id)
      );
    } catch (err) {
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  router.delete("/projects/cards/:id", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const pid = ensureUserProject(access.ownerUserId, access.db);
      const r = access.db
        .prepare(`DELETE FROM ai_project_cards WHERE id=? AND project_id=?`)
        .run(req.params.id, pid);
      res.json({ ok: r.changes > 0 });
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

  router.post("/projects/cards/:id/comments", (req, res) => {
    try {
      const access = resolveUserTasksAccess(req, "editor");
      requireWriteAccess(access);
      const pid = ensureUserProject(access.ownerUserId, access.db);
      const card = access.db
        .prepare(`SELECT id FROM ai_project_cards WHERE id=? AND project_id=?`)
        .get(req.params.id, pid);
      if (!card) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const body = String(req.body?.body ?? "").trim();
      if (!body) {
        res.status(400).json({ error: "body required" });
        return;
      }
      const author = req.body?.author === "agent" ? "agent" : "user";
      const id = uuidv4();
      access.db.prepare(
        `INSERT INTO ai_card_comments (id, card_id, author, body) VALUES (?, ?, ?, ?)`
      ).run(id, req.params.id, author, body);
      res
        .status(201)
        .json(access.db.prepare(`SELECT * FROM ai_card_comments WHERE id = ?`).get(id));
    } catch (err) {
      if (!handleShareError(err, res)) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  return router;
}
