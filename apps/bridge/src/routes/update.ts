import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import type { CoreDatabase } from "../core-db.js";
import { readinessDiagnostics } from "../services/release-flow.js";

/** Host-updater diagnostics — authenticated by UPDATE_READINESS_TOKEN, not sessions. */
export function createUpdateRouter(coreDb: CoreDatabase): Router {
  const router = Router();

  router.get("/readiness", (req, res) => {
    const configured = process.env.UPDATE_READINESS_TOKEN ?? "";
    const presented = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const authorized =
      configured.length > 0 &&
      configured.length === presented.length &&
      timingSafeEqual(Buffer.from(configured), Buffer.from(presented));
    if (!authorized) {
      res.status(401).json({ ok: false, error: "Update readiness token required" });
      return;
    }
    const diagnostics = readinessDiagnostics(coreDb);
    res.json({
      ok: diagnostics.every((item) => !item.blocking || item.ok),
      version: process.env.GODMODE_VERSION ?? "0.1.0",
      commit: process.env.GODMODE_COMMIT ?? "unknown",
      diagnostics,
    });
  });

  return router;
}
