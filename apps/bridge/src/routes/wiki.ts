import { Router } from "express";
import { getCloudDb } from "../core-db.js";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
  requireEditorForMutation,
} from "../services/auth/middleware.js";
import { getUserOwnerTenantId } from "../services/user-scope.js";
import { ensureWelcomeWikiPage } from "../services/welcome-wiki.js";
import {
  getBacklinksForPage,
  getPageBySlug,
  getPublicPageBySlug,
  listPages,
  wikiDbForTenant,
  WikiError,
  type WikiScope,
} from "../services/wiki-service.js";
import { listWikiProposals } from "../services/wiki-proposals.js";
import type { WikiVisibility } from "../core-db.js";
import type { EmbeddingManager } from "../services/embeddings/embedding-manager.js";

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function resolveScope(userId: string): WikiScope {
  const rows = getCloudDb()
    .prepare(`SELECT tenant_id FROM tenant_memberships WHERE user_id = ?`)
    .all(userId) as Array<{ tenant_id: string }>;
  const tenantIds = rows.map((r) => r.tenant_id);
  const owner = getUserOwnerTenantId(userId);
  if (owner && !tenantIds.includes(owner)) tenantIds.push(owner);
  return { tenantIds };
}

export function createWikiRouter(embeddings?: EmbeddingManager): Router {
  const router = Router();

  // Public, unauthenticated read path for published (external) pages.
  router.get("/public/:slug", (req, res) => {
    try {
      res.json({ page: getPublicPageBySlug(paramId(req.params.slug)) });
    } catch (err) {
      if (err instanceof WikiError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.use(attachAuthContext, requireAuth, resolveTenant, requireEditorForMutation);

  router.get("/proposals", (req, res) => {
    const status = String(req.query.status ?? "pending") as
      | "pending"
      | "approved"
      | "rejected"
      | "all";
    const tenantId = req.tenantId ?? getUserOwnerTenantId(req.user!.id);
    if (!tenantId) {
      res.json({ proposals: [] });
      return;
    }
    res.json({
      proposals: listWikiProposals(
        { tenantId, status },
        wikiDbForTenant(tenantId)
      ),
    });
  });

  router.get("/pages", (req, res) => {
    const scope = resolveScope(req.user!.id);
    const visibility = req.query.visibility as WikiVisibility | undefined;
    res.json({
      pages: listPages(scope, {
        visibility:
          visibility === "internal" || visibility === "external"
            ? visibility
            : undefined,
        space: typeof req.query.space === "string" ? req.query.space : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
      }),
    });
  });

  router.get("/pages/:slug", (req, res) => {
    const scope = resolveScope(req.user!.id);
    const slug = paramId(req.params.slug);
    if (slug === "welcome" && req.tenantId) {
      ensureWelcomeWikiPage(
        wikiDbForTenant(req.tenantId),
        req.tenantId,
        req.user!.id
      );
    }
    try {
      const page = getPageBySlug(slug, scope);
      const backlinks = getBacklinksForPage(page.id, scope);
      res.json({ page, backlinks });
    } catch (err) {
      if (err instanceof WikiError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
