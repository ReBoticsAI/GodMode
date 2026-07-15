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

  return router;
}
