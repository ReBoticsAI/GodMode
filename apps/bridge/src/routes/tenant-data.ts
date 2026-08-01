/**
 * Tenant workspace data export (#235).
 * Owner-only download of the caller's tenant SQLite snapshot.
 */
import { Router } from "express";
import { getCoreDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  requireTenantRole,
  resolveTenant,
} from "../services/auth/middleware.js";
import { durableRateLimit } from "../services/auth/rate-limit.js";
import {
  TenantDatabaseExportError,
  cleanupTenantSnapshot,
  createTenantDatabaseSnapshot,
  logTenantDatabaseDownloadAudit,
  lookupTenantSlug,
  sanitizeWorkspaceFilenameSlug,
  streamTenantSqliteFile,
} from "../services/tenant-database-export.js";

const tenantDbDownloadLimiter = durableRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many database downloads; try again later",
  key: (req) =>
    `tenant-db-download:${req.user?.id ?? "anon"}:${req.tenantId ?? "none"}`,
});

export function createTenantDataRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get(
    "/database/download",
    requireTenantRole("owner"),
    tenantDbDownloadLimiter,
    async (req, res) => {
      const tenantId = req.tenantId!;
      const userId = req.user!.id;
      const tenantDb = req.tenantDb!;
      let snapshotPath: string | null = null;

      try {
        const snapshot = await createTenantDatabaseSnapshot(tenantDb);
        snapshotPath = snapshot.filePath;
        const slug =
          lookupTenantSlug(getCoreDb(), tenantId) ??
          sanitizeWorkspaceFilenameSlug(tenantId);
        const filename = `godmode-workspace-${sanitizeWorkspaceFilenameSlug(slug)}.sqlite`;

        res.setHeader("Content-Type", "application/x-sqlite3");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Length", String(snapshot.bytes));

        await streamTenantSqliteFile(snapshot.filePath, res);
        logTenantDatabaseDownloadAudit(getCoreDb(), {
          userId,
          tenantId,
          bytes: snapshot.bytes,
          result: "ok",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logTenantDatabaseDownloadAudit(getCoreDb(), {
          userId,
          tenantId,
          bytes: 0,
          result: "failed",
          error: message,
        });
        if (err instanceof TenantDatabaseExportError) {
          if (!res.headersSent) {
            res.status(err.status).json({ error: err.message });
          } else {
            res.end();
          }
          return;
        }
        if (!res.headersSent) {
          res.status(500).json({ error: "Workspace database download failed" });
        } else {
          res.end();
        }
      } finally {
        if (snapshotPath) cleanupTenantSnapshot(snapshotPath);
      }
    }
  );

  return router;
}
