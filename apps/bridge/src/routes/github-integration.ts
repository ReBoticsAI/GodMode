import { Router } from "express";
import { config } from "../config.js";
import {
  exchangeGithubIntegrationCode,
  takeGithubIntegrationOauthPending,
  upsertGithubProjectsToken,
} from "../services/github-integration.js";
import { getUserDb } from "../user-registry.js";

/**
 * OAuth browser callback only. Status / connect / disconnect are
 * GithubIntegration ObjectType collection actions (#603 P1b).
 */
export function createGithubIntegrationRouter(): Router {
  const router = Router();

  /** Browser redirect callback — no session cookie required if state is valid. */
  router.get("/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const installationIdRaw =
      typeof req.query.installation_id === "string"
        ? req.query.installation_id
        : "";
    const pending = takeGithubIntegrationOauthPending(state);
    const webBase = config.web.publicUrl.replace(/\/$/, "");
    const successPath = pending?.returnPath
      ? pending.returnPath.includes("?")
        ? `${pending.returnPath}&github=connected`
        : `${pending.returnPath}?github=connected`
      : "/vault?tab=integrations&github=connected";
    const errorPath = pending?.returnPath
      ? pending.returnPath.includes("?")
        ? `${pending.returnPath}&github=error`
        : `${pending.returnPath}?github=error`
      : "/vault?tab=integrations&github=error";
    if (!code || !pending) {
      res.redirect(`${webBase}/vault?tab=integrations&github=error`);
      return;
    }
    try {
      const token = await exchangeGithubIntegrationCode(code);
      const fromQuery = Number(installationIdRaw);
      if (Number.isFinite(fromQuery) && fromQuery > 0) {
        token.installationId = fromQuery;
      }
      const db = getUserDb(pending.userId);
      upsertGithubProjectsToken(db, token, pending.userId);
      res.redirect(`${webBase}${successPath}`);
    } catch (err) {
      console.error("[github-integration] callback", err);
      res.redirect(`${webBase}${errorPath}`);
    }
  });

  return router;
}
