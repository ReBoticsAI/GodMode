import { Router } from "express";
import { getCoreDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import {
  AdminUsersError,
  createAdminTenantForUser,
  createAdminUser,
  deleteAdminTenant,
  deleteAdminUser,
  getAdminUser,
  listAdminUsers,
  updateAdminTenant,
  updateAdminUser,
} from "../services/admin-users.js";

export function createAdminUsersRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/users", (_req, res) => {
    const core = getCoreDb();
    res.json({ users: listAdminUsers(core) });
  });

  router.get("/users/:userId", (req, res) => {
    const core = getCoreDb();
    const user = getAdminUser(core, req.params.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user });
  });

  return router;
}

function handleAdminUsersError(
  res: import("express").Response,
  err: unknown
): void {
  if (err instanceof AdminUsersError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[admin-users]", err);
  res.status(500).json({ error: "Internal server error" });
}
