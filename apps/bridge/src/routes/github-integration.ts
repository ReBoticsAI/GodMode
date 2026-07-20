import { randomBytes } from "node:crypto";
import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import { config } from "../config.js";
import {
  buildGithubIntegrationAuthorizeUrl,
  clearGithubProjectsToken,
  exchangeGithubIntegrationCode,
  githubProjectsStatus,
  upsertGithubProjectsToken,
} from "../services/github-integration.js";
import { getUserOwnerTenantDb } from "../services/user-scope.js";

/** Short-lived OAuth state → userId */
const pendingStates = new Map<
  string,
  { userId: string; expiresAt: number }
>();

function pruneStates(): void {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (v.expiresAt < now) pendingStates.delete(k);
  }
}

export function createGithubIntegrationRouter(): Router {
  const router = Router();

  router.get(
    "/status",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    (req, res) => {
      const db = getUserOwnerTenantDb(req.user!.id);
      res.json(githubProjectsStatus(db));
    }
  );

  router.post(
    "/connect",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    (req, res) => {
      try {
        pruneStates();
        const state = randomBytes(16).toString("hex");
        pendingStates.set(state, {
          userId: req.user!.id,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
        const url = buildGithubIntegrationAuthorizeUrl(state);
        res.json({ url });
      } catch (err) {
        const e = err as { status?: number; message?: string };
        res.status(e?.status ?? 500).json({ error: e?.message ?? String(err) });
      }
    }
  );

  router.post(
    "/disconnect",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    (req, res) => {
      const db = getUserOwnerTenantDb(req.user!.id);
      clearGithubProjectsToken(db);
      res.json({ ok: true });
    }
  );

  /** Browser redirect callback — no session cookie required if state is valid. */
  router.get("/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const pending = state ? pendingStates.get(state) : undefined;
    if (pending) pendingStates.delete(state);
    const webBase = config.web.publicUrl.replace(/\/$/, "");
    if (!code || !pending || pending.expiresAt < Date.now()) {
      res.redirect(`${webBase}/settings?github=error`);
      return;
    }
    try {
      const token = await exchangeGithubIntegrationCode(code);
      const db = getUserOwnerTenantDb(pending.userId);
      upsertGithubProjectsToken(db, token);
      res.redirect(`${webBase}/settings?github=connected`);
    } catch (err) {
      console.error("[github-integration] callback", err);
      res.redirect(`${webBase}/settings?github=error`);
    }
  });

  return router;
}
