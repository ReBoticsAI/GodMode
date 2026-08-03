import { Router } from "express";
import { getCoreDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  requirePlatformAdmin,
} from "../services/auth/middleware.js";
import { rateLimit } from "../services/auth/rate-limit.js";
import { listPlatformRequestLogs } from "../services/request-log.js";
import { runLocalPlatformBackup } from "../services/platform-backup.js";
import {
  BackupStampError,
  listBackupStamps,
  logBackupDownloadAudit,
  resolveBackupStampDir,
  streamBackupStampTarGz,
} from "../services/platform-backup-archive.js";
import {
  getSellerVerifiedSnapshot,
  listSellerAccountsForAdmin,
  MarketplaceCommerceError,
  setSellerVerified,
  setSellerVerifiedFrozen,
} from "../services/marketplace-commerce.js";

const backupDownloadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many backup downloads; try again later",
});

/** Read-only U2U marketplace fee ledger + backup status for platform admins. */
export function createAdminMarketplaceRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, requirePlatformAdmin);

  router.get("/sellers", (req, res) => {
    const limit = Number(req.query.limit ?? 200);
    res.json({
      sellers: listSellerAccountsForAdmin(
        getCoreDb(),
        Number.isFinite(limit) ? limit : 200
      ),
    });
  });

  router.post("/sellers/verified", (req, res) => {
    try {
      const body = req.body ?? {};
      const userId = String(body.userId ?? body.user_id ?? "").trim();
      const verifiedRaw = body.verifiedSeller ?? body.verified_seller ?? body.verified;
      if (!userId) {
        res.status(400).json({ error: "userId required" });
        return;
      }
      let verified: boolean | null = null;
      if (typeof verifiedRaw === "boolean") verified = verifiedRaw;
      else if (verifiedRaw === 1 || verifiedRaw === "1" || verifiedRaw === "true") verified = true;
      else if (verifiedRaw === 0 || verifiedRaw === "0" || verifiedRaw === "false") verified = false;
      if (verified === null) {
        res.status(400).json({ error: "verifiedSeller boolean required" });
        return;
      }
      const seller = setSellerVerified(getCoreDb(), { userId, verified });
      const snap = getSellerVerifiedSnapshot(getCoreDb(), userId);
      res.json({
        seller: {
          id: seller.id,
          userId: seller.user_id,
          verifiedSeller: snap.verifiedSeller,
          verifiedFrozen: snap.verifiedFrozen,
          earnedTier: snap.earnedTier,
          verifiedTier: snap.verifiedTier,
          listingCount: snap.listingCount,
          onboardingStatus: seller.onboarding_status,
          updatedAt: seller.updated_at,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update verified seller";
      const status = err instanceof MarketplaceCommerceError ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post("/sellers/frozen", (req, res) => {
    try {
      const body = req.body ?? {};
      const userId = String(body.userId ?? body.user_id ?? "").trim();
      const frozenRaw = body.verifiedFrozen ?? body.verified_frozen ?? body.frozen;
      if (!userId) {
        res.status(400).json({ error: "userId required" });
        return;
      }
      let frozen: boolean | null = null;
      if (typeof frozenRaw === "boolean") frozen = frozenRaw;
      else if (frozenRaw === 1 || frozenRaw === "1" || frozenRaw === "true") frozen = true;
      else if (frozenRaw === 0 || frozenRaw === "0" || frozenRaw === "false") frozen = false;
      if (frozen === null) {
        res.status(400).json({ error: "verifiedFrozen boolean required" });
        return;
      }
      const seller = setSellerVerifiedFrozen(getCoreDb(), { userId, frozen });
      const snap = getSellerVerifiedSnapshot(getCoreDb(), userId);
      res.json({
        seller: {
          id: seller.id,
          userId: seller.user_id,
          verifiedSeller: snap.verifiedSeller,
          verifiedFrozen: snap.verifiedFrozen,
          earnedTier: snap.earnedTier,
          verifiedTier: snap.verifiedTier,
          listingCount: snap.listingCount,
          onboardingStatus: seller.onboarding_status,
          updatedAt: seller.updated_at,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update seller freeze";
      const status = err instanceof MarketplaceCommerceError ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

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

  router.post("/backup", async (_req, res) => {
    const result = await runLocalPlatformBackup(getCoreDb());
    if (result.status !== "ok") {
      res.status(500).json({
        error: result.error ?? "Backup failed",
        backup: result,
      });
      return;
    }
    res.json({
      backup: {
        status: result.status,
        localPath: result.localPath,
        remoteUri: result.remoteUri,
        error: result.error,
        updatedAt: result.updatedAt,
      },
    });
  });

  router.get("/backup/stamps", (_req, res) => {
    const limit = Number(_req.query.limit ?? 30);
    const stamps = listBackupStamps(Number.isFinite(limit) ? limit : 30).map(
      (s) => ({
        stamp: s.stamp,
        createdAt: s.createdAt,
        hasManifest: s.hasManifest,
        bytes: s.bytes,
      })
    );
    res.json({ stamps });
  });

  router.get("/backup/download", backupDownloadLimiter, async (req, res) => {
    const raw =
      typeof req.query.stamp === "string" && req.query.stamp.trim()
        ? req.query.stamp.trim()
        : "latest";
    const userId = req.user!.id;
    try {
      const { stamp, dir } = resolveBackupStampDir(raw);
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="godmode-backup-${stamp}.tar.gz"`
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const stats = await streamBackupStampTarGz(stamp, dir, res);
      logBackupDownloadAudit(getCoreDb(), {
        userId,
        stamp,
        bytesIn: stats.bytesIn,
        fileCount: stats.fileCount,
        result: "ok",
      });
    } catch (err) {
      if (err instanceof BackupStampError) {
        if (!res.headersSent) {
          res.status(err.status).json({ error: err.message });
        } else {
          res.end();
        }
        logBackupDownloadAudit(getCoreDb(), {
          userId,
          stamp: raw,
          bytesIn: 0,
          fileCount: 0,
          result: "failed",
          error: err.message,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logBackupDownloadAudit(getCoreDb(), {
        userId,
        stamp: raw,
        bytesIn: 0,
        fileCount: 0,
        result: "failed",
        error: message,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Backup download failed" });
      } else {
        res.end();
      }
    }
  });

  return router;
}

/** First-party ops log (stdout JSON + core.sqlite). No external APM. */
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
