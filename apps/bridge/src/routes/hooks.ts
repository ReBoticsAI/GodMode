import { Router } from "express";
import { attachAuthContext, requireAuth } from "../services/auth/middleware.js";
import {
  getUserOwnerTenantDb,
  getUserOwnerTenantId,
} from "../services/user-scope.js";
import { listAgents } from "../services/agents/agents-db.js";
import {
  createHook,
  deleteHook,
  getHook,
  HookError,
  listHookRuns,
  listHooks,
  updateHook,
  getHookForRun,
  type HookOwnerScope,
} from "../services/hook-service.js";
import { refreshScheduler } from "../services/scheduler.js";
import { approveHookRun, rejectHookRun } from "../services/hook-dispatcher.js";
import {
  emitEvent,
  listEventsForOwner,
  listKnownEventTypes,
} from "../services/event-bus.js";

function resolveScope(userId: string): HookOwnerScope {
  const tenantId = getUserOwnerTenantId(userId);
  const agentIds = listAgents(getUserOwnerTenantDb(userId)).map((a) => a.id);
  return { userId, tenantId, agentIds };
}

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

export function createHooksRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth);

  router.get("/", (req, res) => {
    const scope = resolveScope(req.user!.id);
    res.json({ hooks: listHooks(scope), agentIds: scope.agentIds });
  });

  router.post("/", (req, res) => {
    const scope = resolveScope(req.user!.id);
    const b = req.body ?? {};
    try {
      const hook = createHook(
        {
          ownerKind: b.ownerKind === "agent" ? "agent" : "user",
          ownerId: b.ownerKind === "agent" ? String(b.ownerId) : req.user!.id,
          ownerTenantId: b.ownerTenantId ?? scope.tenantId,
          name: String(b.name ?? "Untitled hook"),
          enabled: b.enabled,
          triggerKind: b.triggerKind === "schedule" ? "schedule" : "event",
          eventType: b.eventType ?? null,
          scheduleCron: b.scheduleCron ?? null,
          conditionJson:
            typeof b.conditionJson === "string"
              ? b.conditionJson
              : b.condition
                ? JSON.stringify(b.condition)
                : null,
          actionKind: b.actionKind,
          actionConfigJson:
            typeof b.actionConfigJson === "string"
              ? b.actionConfigJson
              : b.actionConfig
                ? JSON.stringify(b.actionConfig)
                : null,
          rateLimitPerHour:
            b.rateLimitPerHour != null ? Number(b.rateLimitPerHour) : null,
          requireApproval: !!b.requireApproval,
        },
        scope
      );
      refreshScheduler();
      res.status(201).json({ hook });
    } catch (err) {
      if (err instanceof HookError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/:id", (req, res) => {
    const scope = resolveScope(req.user!.id);
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

  router.patch("/:id", (req, res) => {
    const scope = resolveScope(req.user!.id);
    try {
      const patch = { ...(req.body ?? {}) };
      if (patch.condition && !patch.conditionJson) {
        patch.conditionJson = JSON.stringify(patch.condition);
      }
      if (patch.actionConfig && !patch.actionConfigJson) {
        patch.actionConfigJson = JSON.stringify(patch.actionConfig);
      }
      const hook = updateHook(paramId(req.params.id), patch, scope);
      refreshScheduler();
      res.json({ hook });
    } catch (err) {
      if (err instanceof HookError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.delete("/:id", (req, res) => {
    const scope = resolveScope(req.user!.id);
    try {
      deleteHook(paramId(req.params.id), scope);
      refreshScheduler();
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof HookError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.get("/:id/runs", (req, res) => {
    const scope = resolveScope(req.user!.id);
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

  router.post("/runs/:runId/approve", async (req, res) => {
    const scope = resolveScope(req.user!.id);
    const runId = paramId(req.params.runId);
    try {
      getHookForRun(runId, scope);
      await approveHookRun(runId);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof HookError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/runs/:runId/reject", (req, res) => {
    const scope = resolveScope(req.user!.id);
    const runId = paramId(req.params.runId);
    try {
      getHookForRun(runId, scope);
      rejectHookRun(runId);
      res.json({ ok: true });
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
    const tenantId = getUserOwnerTenantId(userId);
    const limit = Number(req.query.limit);
    res.json({
      events: listEventsForOwner(
        { kind: "user", id: userId, tenantId },
        { limit: Number.isFinite(limit) ? limit : undefined }
      ),
      eventTypes: listKnownEventTypes(),
    });
  });

  // Emit a custom event over HTTP using the same emitEvent → dispatchEvent path
  // the `emit_event` tool uses, so event-triggered hooks fire. Attributed to an
  // owned agent when `actorAgentId` is one of the caller's agents, else the user.
  router.post("/", (req, res) => {
    const userId = req.user!.id;
    const tenantId = getUserOwnerTenantId(userId);
    const eventType = String(req.body?.eventType ?? req.body?.type ?? "").trim();
    if (!eventType) {
      res.status(400).json({ error: "eventType required" });
      return;
    }
    const payload =
      req.body?.payload && typeof req.body.payload === "object"
        ? (req.body.payload as Record<string, unknown>)
        : {};
    const actorAgentId = req.body?.actorAgentId
      ? String(req.body.actorAgentId)
      : null;
    const ownedAgentIds = listAgents(getUserOwnerTenantDb(userId)).map((a) => a.id);
    const actor =
      actorAgentId && ownedAgentIds.includes(actorAgentId)
        ? { kind: "agent" as const, id: actorAgentId }
        : { kind: "user" as const, id: userId };
    const event = emitEvent({ type: eventType, actor, payload, tenantId });
    res.status(201).json({ event });
  });

  return router;
}
