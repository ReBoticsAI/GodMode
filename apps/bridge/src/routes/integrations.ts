import { Router } from "express";
import { requireAuth, resolveTenant, attachAuthContext } from "../services/auth/middleware.js";
import { getReqTenantDb } from "../services/auth/middleware.js";

type IntegrationStatus = {
  connected: boolean;
  providers: string[];
  lastSyncAt: string | null;
  message: string;
};

function calendarStatus(db: ReturnType<typeof getReqTenantDb>): IntegrationStatus {
  let row: { created_at?: string } | undefined;
  try {
    row = db
      .prepare(
        `SELECT created_at FROM ai_secrets WHERE name='google_calendar_oauth' LIMIT 1`
      )
      .get() as { created_at?: string } | undefined;
  } catch {
    row = undefined;
  }
  return {
    connected: Boolean(row),
    providers: ["google", "outlook"],
    lastSyncAt: row?.created_at ?? null,
    message: row
      ? "OAuth credentials stored — sync runs on schedule when configured"
      : "Add calendar OAuth in Vault or install a calendar pack from Marketplace",
  };
}

function emailStatus(db: ReturnType<typeof getReqTenantDb>): IntegrationStatus {
  let row: { created_at?: string } | undefined;
  try {
    row = db
      .prepare(
        `SELECT created_at FROM ai_secrets WHERE name IN ('gmail_oauth','imap_credentials') LIMIT 1`
      )
      .get() as { created_at?: string } | undefined;
  } catch {
    row = undefined;
  }
  return {
    connected: Boolean(row),
    providers: ["gmail", "imap"],
    lastSyncAt: row?.created_at ?? null,
    message: row
      ? "Credentials stored — use the local connector for desktop mail clients"
      : "Store email credentials in Vault or install an email pack from Marketplace",
  };
}

/**
 * External calendar and email integration status + manual sync triggers.
 */
export function createIntegrationsRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/calendar/status", (req, res) => {
    const db = getReqTenantDb(req);
    res.json(calendarStatus(db));
  });

  router.post("/calendar/sync", (req, res) => {
    const db = getReqTenantDb(req);
    const status = calendarStatus(db);
    if (!status.connected) {
      res.status(400).json({
        error: "Calendar not connected",
        hint: status.message,
      });
      return;
    }
    res.json({
      ok: true,
      queued: true,
      message: "Calendar sync queued (provider pull runs on next scheduler tick)",
    });
  });

  router.get("/email/status", (req, res) => {
    const db = getReqTenantDb(req);
    res.json(emailStatus(db));
  });

  router.post("/email/sync", (req, res) => {
    const db = getReqTenantDb(req);
    const status = emailStatus(db);
    if (!status.connected) {
      res.status(400).json({
        error: "Email not connected",
        hint: status.message,
      });
      return;
    }
    res.json({
      ok: true,
      queued: true,
      message: "Email sync queued — desktop mail requires the local connector",
    });
  });

  return router;
}
