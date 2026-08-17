import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import { listPublisherConnectors } from "../services/publisher-connectors.js";

export function createPublisherConnectorsRouter(): Router {
  const router = Router();
  router.get(
    "/",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    (_req, res) => {
      res.json({ connectors: listPublisherConnectors() });
    }
  );
  return router;
}
