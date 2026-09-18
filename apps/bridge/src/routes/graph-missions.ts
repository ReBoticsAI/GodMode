import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  tenantDbMiddleware,
} from "../services/auth/middleware.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import { config } from "../config.js";
import {
  completeGraphMission,
  getGraphMissionsStatus,
  listGraphLeaderboard,
  syncAutoCompleteMissions,
  type GraphLeaderboardTimeframe,
} from "../services/graph-missions.js";
import { GRAPH_MISSIONS_CATALOG_VERSION } from "../services/graph-missions-catalog.js";

export function createGraphMissionsRouter(): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 90,
    message: "Too many graph mission requests",
  });
  const completeLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    message: "Too many mission completions",
  });

  router.get("/", attachAuthContext, limiter, (req, res) => {
    const respond = () => {
      try {
        const userId =
          req.user?.id ??
          (config.auth.allowAnonymous ? "system-local" : undefined);
        const displayName =
          req.user?.displayName?.trim() ||
          req.user?.email?.split("@")[0] ||
          "Human";
        let awarded: Array<{ missionId: string; points: number }> = [];
        if (userId && userId !== "system-local") {
          awarded = syncAutoCompleteMissions({
            userId,
            displayName,
            tenantDb: req.tenantDb ?? null,
            instanceId: process.env.INSTALLATION_SURFACE?.trim() || "local",
          }).awarded;
        }
        const status = getGraphMissionsStatus({
          userId,
          tenantDb: req.tenantDb ?? null,
        });
        res.json({
          ...status,
          catalogVersion: GRAPH_MISSIONS_CATALOG_VERSION,
          autoAwarded: awarded,
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    if (req.user && !req.tenantDb) {
      tenantDbMiddleware(req, res, respond);
      return;
    }
    respond();
  });

  router.post(
    "/sync",
    attachAuthContext,
    requireAuth,
    completeLimiter,
    (req, res) => {
      const run = () => {
        try {
          const displayName =
            req.user!.displayName?.trim() ||
            req.user!.email?.split("@")[0] ||
            "Human";
          const { awarded } = syncAutoCompleteMissions({
            userId: req.user!.id,
            displayName,
            tenantDb: req.tenantDb ?? null,
            instanceId: process.env.INSTALLATION_SURFACE?.trim() || "local",
          });
          const status = getGraphMissionsStatus({
            userId: req.user!.id,
            tenantDb: req.tenantDb ?? null,
          });
          res.json({ ok: true, awarded, ...status });
        } catch (err) {
          const status =
            err && typeof err === "object" && "status" in err
              ? Number((err as { status: number }).status)
              : 500;
          res.status(Number.isFinite(status) ? status : 500).json({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
      if (!req.tenantDb) {
        tenantDbMiddleware(req, res, run);
        return;
      }
      run();
    }
  );
  router.get("/leaderboard", attachAuthContext, limiter, (req, res) => {
    try {
      const limitRaw =
        typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
      const timeframeRaw =
        typeof req.query.timeframe === "string"
          ? (req.query.timeframe.toLowerCase().trim() as GraphLeaderboardTimeframe)
          : undefined;
      const entries = listGraphLeaderboard({
        limit: Number.isFinite(limitRaw) ? limitRaw : 50,
        timeframe: timeframeRaw,
      });
      res.json({ entries });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post(
    "/:id/complete",
    attachAuthContext,
    requireAuth,
    completeLimiter,
    (req, res) => {
      const run = () => {
        try {
          const displayName =
            req.user!.displayName?.trim() ||
            req.user!.email?.split("@")[0] ||
            "Human";
          const result = completeGraphMission({
            missionId: String(req.params.id ?? "").trim(),
            userId: req.user!.id,
            displayName,
            tenantDb: req.tenantDb ?? null,
            instanceId: process.env.INSTALLATION_SURFACE?.trim() || "local",
          });
          res.json(result);
        } catch (err) {
          const status =
            err && typeof err === "object" && "status" in err
              ? Number((err as { status: number }).status)
              : 500;
          res.status(Number.isFinite(status) ? status : 500).json({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
      if (!req.tenantDb) {
        tenantDbMiddleware(req, res, run);
        return;
      }
      run();
    }
  );

  return router;
}
