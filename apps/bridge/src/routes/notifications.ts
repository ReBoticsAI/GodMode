import { Router } from "express";
import { attachAuthContext, requireAuth } from "../services/auth/middleware.js";
import {
  clearNotifications,
  deleteNotification,
  listNotificationsForUser,
  markAllRead,
  markRead,
  unreadCount,
} from "../services/notification-service.js";

export function createNotificationsRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth);

  router.get("/", (req, res) => {
    const userId = req.user!.id;
    const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
    const limit = Number(req.query.limit);
    const notifications = listNotificationsForUser(userId, {
      unreadOnly,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ notifications, unreadCount: unreadCount({ kind: "user", id: userId }) });
  });

  router.get("/unread-count", (req, res) => {
    res.json({ unreadCount: unreadCount({ kind: "user", id: req.user!.id }) });
  });

  router.post("/read", (req, res) => {
    const userId = req.user!.id;
    const { ids, all } = req.body ?? {};
    if (all === true) {
      const updated = markAllRead({ kind: "user", id: userId });
      res.json({ updated, unreadCount: unreadCount({ kind: "user", id: userId }) });
      return;
    }
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
    const updated = markRead(list);
    res.json({ updated, unreadCount: unreadCount({ kind: "user", id: userId }) });
  });

  // Clear notifications for the caller. `?readOnly=1` keeps unread ones.
  router.post("/clear", (req, res) => {
    const userId = req.user!.id;
    const readOnly = req.body?.readOnly === true || req.query.readOnly === "1";
    const deleted = clearNotifications({ kind: "user", id: userId }, { readOnly });
    res.json({ deleted, unreadCount: unreadCount({ kind: "user", id: userId }) });
  });

  router.delete("/:id", (req, res) => {
    const userId = req.user!.id;
    const deleted = deleteNotification(req.params.id, { kind: "user", id: userId });
    if (deleted === 0) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ ok: true, unreadCount: unreadCount({ kind: "user", id: userId }) });
  });

  return router;
}
