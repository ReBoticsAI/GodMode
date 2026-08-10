import { Router, type Request } from "express";
import {
  attachAuthContext,
  getReqTenantDb,
  requireAuth,
} from "../services/auth/middleware.js";
import {
  getUserOwnerTenantDb,
  getUserOwnerTenantId,
} from "../services/user-scope.js";
import { listAgents } from "../services/agents/agents-db.js";
import {
  getHook,
  HookError,
  listHookRuns,
  listHooks,
  type HookOwnerScope,
} from "../services/hook-service.js";
import {
  listEventsForOwner,
  listKnownEventTypes,
} from "../services/event-bus.js";

function resolveScope(req: Request): HookOwnerScope {
  const userId = req.user!.id;
  const tenantId = req.tenantId ?? getUserOwnerTenantId(userId);
  const agentDb = req.tenantId
    ? getReqTenantDb(req)
    : getUserOwnerTenantDb(userId);
  const agentIds = listAgents(agentDb).map((a) => a.id);
  return { userId, tenantId, agentIds };
}

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

export function createHooksRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth);

  router.get("/", (req, res) => {
    const scope = resolveScope(req);
    res.json({ hooks: listHooks(scope), agentIds: scope.agentIds });
  });

  router.get("/:id", (req, res) => {
    const scope = resolveScope(req);
    try {
      res.json({ hook: getHook(paramId(req.params.id), scope) });
    } catch (err) {
      if (err instanceof HookError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/:id/runs", (req, res) => {
    const scope = resolveScope(req);
    try {
      res.json({ runs: listHookRuns(paramId(req.params.id), scope) });
    } catch (err) {
      if (err instanceof HookError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}

export function createEventsRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth);

  router.get("/", (req, res) => {
    const userId = req.user!.id;
    const tenantId = req.tenantId ?? getUserOwnerTenantId(userId);
    const limit = Number(req.query.limit);
    res.json({
      events: listEventsForOwner(
        { kind: "user", id: userId, tenantId },
        { limit: Number.isFinite(limit) ? limit : undefined }
      ),
      eventTypes: listKnownEventTypes(),
    });
  });

  return router;
}
