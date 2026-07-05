import { Router } from "express";
import { requireAuth, resolveTenant, attachAuthContext, getReqTenantDb } from "../services/auth/middleware.js";

/**
 * Bank ledger entries (placeholder until full transaction sync).
 */
export function createBankRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/ledger", (req, res) => {
    const db = getReqTenantDb(req);
    let entries: Array<Record<string, unknown>> = [];
    try {
      entries = db
        .prepare(
          `SELECT id, category, label, amount, currency, recorded_at, source
           FROM bank_ledger_entries
           ORDER BY recorded_at DESC
           LIMIT 100`
        )
        .all() as Array<Record<string, unknown>>;
    } catch {
      entries = [];
    }

    res.json({ entries, synced: false });
  });

  return router;
}
