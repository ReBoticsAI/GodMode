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

  router.post("/users", (req, res) => {
    const { email, password, displayName, isAdmin, provisionDefaultTenant } =
      req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "email and password required" });
      return;
    }
    try {
      const core = getCoreDb();
      const user = createAdminUser(core, {
        email,
        password,
        displayName: typeof displayName === "string" ? displayName : undefined,
        isAdmin: Boolean(isAdmin),
        provisionDefaultTenant: provisionDefaultTenant !== false,
      });
      res.status(201).json({ user });
    } catch (err) {
      handleAdminUsersError(res, err);
    }
  });

  router.patch("/users/:userId", (req, res) => {
    const { email, displayName, isAdmin, password } = req.body ?? {};
    try {
      const core = getCoreDb();
      const user = updateAdminUser(core, req.params.userId, {
        email: typeof email === "string" ? email : undefined,
        displayName: typeof displayName === "string" ? displayName : undefined,
        isAdmin: isAdmin !== undefined ? Boolean(isAdmin) : undefined,
        password: typeof password === "string" && password ? password : undefined,
      });
      res.json({ user });
    } catch (err) {
      handleAdminUsersError(res, err);
    }
  });

  router.delete("/users/:userId", (req, res) => {
    try {
      const core = getCoreDb();
      deleteAdminUser(core, req.params.userId, req.user!.id);
      res.json({ ok: true });
    } catch (err) {
      handleAdminUsersError(res, err);
    }
  });

  router.post("/users/:userId/tenants", (req, res) => {
    const { name, slug } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name required" });
      return;
    }
    try {
      const core = getCoreDb();
      const tenant = createAdminTenantForUser(
        core,
        req.params.userId,
        name,
        typeof slug === "string" ? slug : undefined
      );
      const user = getAdminUser(core, req.params.userId);
      res.status(201).json({ tenant, user });
    } catch (err) {
      handleAdminUsersError(res, err);
    }
  });

  router.patch("/tenants/:tenantId", (req, res) => {
    const { name, slug } = req.body ?? {};
    try {
      const core = getCoreDb();
      const tenant = updateAdminTenant(core, req.params.tenantId, {
        name: typeof name === "string" ? name : undefined,
        slug: typeof slug === "string" ? slug : undefined,
      });
      res.json({ tenant });
    } catch (err) {
      handleAdminUsersError(res, err);
    }
  });

  router.delete("/tenants/:tenantId", (req, res) => {
    try {
      const core = getCoreDb();
      deleteAdminTenant(core, req.params.tenantId);
      res.json({ ok: true });
    } catch (err) {
      handleAdminUsersError(res, err);
    }
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
