import { Router } from "express";
import { getCoreDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import { listPlatformRequestLogs } from "../services/request-log.js";

/** Read-only U2U marketplace fee ledger + backup status for platform admins. */
export function createAdminMarketplaceRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/fees", (_req, res) => {
    const core = getCoreDb();
    const rows = core
      .prepare(
        `SELECT id, amount_cents, platform_fee_cents, status, provider,
                seller_user_id, created_at, delivered_at
         FROM marketplace_orders
         WHERE seller_kind = 'user'
         ORDER BY created_at DESC
         LIMIT 500`
      )
      .all() as Array<{
      id: string;
      amount_cents: number;
      platform_fee_cents: number;
      status: string;
      provider: string;
      seller_user_id: string | null;
      created_at: string;
      delivered_at: string | null;
    }>;

    const paid = rows.filter((r) =>
      ["paid", "delivered", "complete", "completed"].includes(r.status)
    );
    const delivered = rows.filter((r) => r.status === "delivered" || r.delivered_at);

    res.json({
      orders: rows.map((r) => ({
        id: r.id,
        amountCents: r.amount_cents,
        platformFeeCents: r.platform_fee_cents,
        status: r.status,
        provider: r.provider,
        sellerUserId: r.seller_user_id,
        createdAt: r.created_at,
        deliveredAt: r.delivered_at,
      })),
      totals: {
        paidCount: paid.length,
        deliveredCount: delivered.length,
        amountCents: paid.reduce((s, r) => s + r.amount_cents, 0),
        platformFeeCents: paid.reduce((s, r) => s + r.platform_fee_cents, 0),
      },
    });
  });

  router.get("/backup-status", (_req, res) => {
    const core = getCoreDb();
    const row = core
      .prepare(`SELECT * FROM platform_backup_meta WHERE id='latest'`)
      .get() as
      | {
          status: string;
          local_path: string | null;
          remote_uri: string | null;
          error: string | null;
          updated_at: string;
        }
      | undefined;
    res.json({
      backup: row
        ? {
            status: row.status,
            localPath: row.local_path,
            remoteUri: row.remote_uri,
            error: row.error,
            updatedAt: row.updated_at,
          }
        : null,
    });
  });

  return router;
}

/** First-party ops log (stdout JSON + core.sqlite) — no external APM. */
export function createAdminObservabilityRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/requests", (req, res) => {
    const core = getCoreDb();
    const limit = Number(req.query.limit ?? 100);
    const level =
      typeof req.query.level === "string" ? req.query.level : undefined;
    res.json({
      requests: listPlatformRequestLogs(core, { limit, level }),
    });
  });

  return router;
}
