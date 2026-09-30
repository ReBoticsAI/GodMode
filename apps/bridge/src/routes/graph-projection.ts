import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  tenantDbMiddleware,
} from "../services/auth/middleware.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import {
  buildArchitectureProjection,
  buildGraphProjection,
} from "../services/graph-projection.js";

export function createGraphProjectionRouter(): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    message: "Too many graph projection requests",
  });

  router.get("/projection", attachAuthContext, limiter, (req, res) => {
    const focusTypeRaw =
      typeof req.query.focusType === "string"
        ? req.query.focusType.trim()
        : "architecture";

    if (focusTypeRaw === "architecture") {
      const respondArchitecture = () => {
        try {
          const projection = buildArchitectureProjection({
            userId: req.user?.id,
            userLabel: req.user
              ? req.user.displayName?.trim() ||
                req.user.email?.split("@")[0] ||
                "You"
              : undefined,
            isAdmin: req.user?.isAdmin,
            tenantDb: req.tenantDb ?? null,
            enrichLiveNeighborhood: Boolean(req.user && req.tenantDb),
          });
          res.json(projection);
        } catch (err) {
          res.status(500).json({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      if (req.user && !req.tenantDb) {
        tenantDbMiddleware(req, res, respondArchitecture);
        return;
      }
      respondArchitecture();
      return;
    }

    requireAuth(req, res, () => {
      tenantDbMiddleware(req, res, () => {
        try {
          const focusType =
            focusTypeRaw === "agent" || focusTypeRaw === "user"
              ? focusTypeRaw
              : "chat";
          const focusId =
            typeof req.query.focusId === "string"
              ? req.query.focusId.trim()
              : "";
          if (!focusId && focusType !== "user") {
            res.status(400).json({ error: "focusId required" });
            return;
          }
          const userId = req.user!.id;
          const projection = buildGraphProjection({
            tenantDb: req.tenantDb!,
            focusType,
            focusId: focusId || userId,
            userId,
            userLabel:
              req.user!.displayName?.trim() ||
              req.user!.email?.split("@")[0] ||
              "You",
          });
          res.json(projection);
        } catch (err) {
          res.status(500).json({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    });
  });

  return router;
}
