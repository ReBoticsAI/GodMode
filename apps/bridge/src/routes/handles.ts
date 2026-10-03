/**
 * Public @username resolve + search (Cloud registry).
 */
import { Router } from "express";
import {
  PublicHandleError,
  assertHandleAvailable,
  resolveHandle,
  searchHandles,
} from "../services/public-handles.js";

/**
 * Read-only handle APIs. Claiming goes through UserProfile.username
 * (kernel Record update) so we do not add a legacy mutation route.
 */
export function createHandlesRouter(): Router {
  const router = Router();

  router.get("/check", (req, res) => {
    const raw =
      typeof req.query.handle === "string"
        ? req.query.handle
        : typeof req.query.q === "string"
          ? req.query.q
          : "";
    try {
      const handle = assertHandleAvailable(raw, {
        forUserId: req.user?.id,
      });
      res.json({ ok: true, handle, available: true });
    } catch (err) {
      if (err instanceof PublicHandleError) {
        res.status(err.status === 409 ? 200 : err.status).json({
          ok: false,
          available: false,
          error: err.message,
        });
        return;
      }
      throw err;
    }
  });

  router.get("/", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    res.json({ handles: searchHandles(q, Number.isFinite(limit) ? limit : 20) });
  });

  router.get("/:handle", (req, res) => {
    const resolved = resolveHandle(String(req.params.handle ?? ""));
    if (!resolved) {
      res.status(404).json({ error: "Handle not found" });
      return;
    }
    if (resolved.kind === "user") {
      res.json({
        kind: "user",
        handle: resolved.handle,
        userId: resolved.userId,
        displayName: resolved.displayName,
        avatarUrl: resolved.avatarUrl,
      });
      return;
    }
    res.json({
      kind: "agent",
      handle: resolved.handle,
      agentId: resolved.agentId,
      agentTenantId: resolved.agentTenantId,
    });
  });

  return router;
}
