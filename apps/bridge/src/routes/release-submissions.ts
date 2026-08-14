import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
} from "../services/auth/middleware.js";
import { getTenantDb } from "../tenant-registry.js";
import {
  getReleaseSubmission,
  listReleaseSubmissions,
  releaseSubmissionMetricsSummary,
  updateReleaseSubmissionFromGithub,
} from "../services/coding/release-submissions.js";
import { getGithubRelease } from "../services/coding/github-release.js";
import { resolveCodingGithubAccessToken } from "../services/coding/git-host-auth.js";
import { getUserOwnerTenantDb } from "../services/user-scope.js";
import { assertCodingKillSwitch } from "../services/coding/coding-quota.js";
import { assertDeployAllowed } from "../services/authority/deploy-authority.js";

export function createReleaseSubmissionsRouter(): Router {
  const router = Router();

  router.get(
    "/",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    (req, res) => {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: "Workspace required" });
        return;
      }
      const db = getTenantDb(tenantId);
      const submissions = listReleaseSubmissions(db, {
        limit: Number(req.query.limit ?? 50),
      });
      res.json({
        submissions,
        metrics: releaseSubmissionMetricsSummary(submissions),
        target: "github_releases",
      });
    }
  );

  router.post(
    "/:id/refresh",
    attachAuthContext,
    requireAuth,
    resolveTenant,
    async (req, res) => {
      try {
        const tenantId = req.tenantId;
        if (!tenantId) {
          res.status(400).json({ error: "Workspace required" });
          return;
        }
        assertCodingKillSwitch(tenantId);
        assertDeployAllowed({
          tenantId,
          userId: req.user!.id,
          action: "github_release_refresh",
        });
        const db = getTenantDb(tenantId);
        const row = getReleaseSubmission(db, String(req.params.id));
        if (!row) {
          res.status(404).json({ error: "Submission not found" });
          return;
        }
        if (!row.github_release_id) {
          res.status(400).json({ error: "Submission has no GitHub release id" });
          return;
        }
        const ownerDb = getUserOwnerTenantDb(req.user!.id);
        const accessToken = await resolveCodingGithubAccessToken(ownerDb);
        const release = await getGithubRelease({
          accessToken,
          owner: row.owner,
          repo: row.repo,
          releaseId: row.github_release_id,
        });
        const updated = updateReleaseSubmissionFromGithub(db, row.id, release);
        res.json({ submission: updated });
      } catch (err) {
        const e = err as { status?: number; message?: string };
        res.status(e?.status ?? 500).json({ error: e?.message ?? String(err) });
      }
    }
  );

  return router;
}
