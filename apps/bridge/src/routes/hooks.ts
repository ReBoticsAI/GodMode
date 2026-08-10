import { Router, type Request } from "express";
import type { CoreDatabase } from "../core-db.js";
import {
  attachAuthContext,
  getReqTenantDb,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
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
  const tenantId = req.tenantId ?? null;
  const agentDb = getReqTenantDb(req);
  const agentIds = listAgents(agentDb).map((a) => a.id);
  return { userId, tenantId, agentIds };
}

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

export function createHooksRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/", (req, res) => {
    const scope = resolveScope(req);
    const workspace = getReqTenantDb(req) as CoreDatabase;
    res.json({
      hooks: listHooks(scope, workspace),
      agentIds: scope.agentIds,
    });
  });

  router.get("/:id", (req, res) => {
    const scope = resolveScope(req);
    const workspace = getReqTenantDb(req) as CoreDatabase;
    try {
      res.json({
        hook: getHook(paramId(req.params.id), scope, workspace),
      });
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
    const workspace = getReqTenantDb(req) as CoreDatabase;
    try {
      res.json({
        runs: listHookRuns(paramId(req.params.id), scope, workspace),
      });
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
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/", (req, res) => {
    const userId = req.user!.id;
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Workspace required" });
      return;
    }
    const workspace = getReqTenantDb(req) as CoreDatabase;
    const limit = Number(req.query.limit);
    res.json({
      events: listEventsForOwner(
        { kind: "user", id: userId, tenantId },
        { limit: Number.isFinite(limit) ? limit : undefined },
        workspace
      ),
      eventTypes: listKnownEventTypes(workspace),
    });
  });

  return router;
}
