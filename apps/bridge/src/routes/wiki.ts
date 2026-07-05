import { Router } from "express";
import { getCoreDb } from "../core-db.js";
import { attachAuthContext, requireAuth, resolveTenant, requireEditorForMutation } from "../services/auth/middleware.js";
import { getUserOwnerTenantId } from "../services/user-scope.js";
import { ensureWelcomeWikiPage } from "../services/welcome-wiki.js";
import {
  createPage,
  deletePage,
  getBacklinksForPage,
  getPageBySlug,
  getPublicPageBySlug,
  listPages,
  updatePage,
  WikiError,
  type WikiScope,
} from "../services/wiki-service.js";
import type { WikiVisibility } from "../core-db.js";

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function resolveScope(userId: string): WikiScope {
  const rows = getCoreDb()
    .prepare(`SELECT tenant_id FROM tenant_memberships WHERE user_id = ?`)
    .all(userId) as Array<{ tenant_id: string }>;
  const tenantIds = rows.map((r) => r.tenant_id);
  const owner = getUserOwnerTenantId(userId);
  if (owner && !tenantIds.includes(owner)) tenantIds.push(owner);
  return { tenantIds };
}

export function createWikiRouter(): Router {
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
      ensureWelcomeWikiPage(getCoreDb(), req.tenantId, req.user!.id);
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

  router.post("/pages", (req, res) => {
    const userId = req.user!.id;
    const tenantId = getUserOwnerTenantId(userId);
    const b = req.body ?? {};
    try {
      const page = createPage({
        tenantId,
        authorUserId: userId,
        title: String(b.title ?? ""),
        bodyMarkdown: typeof b.bodyMarkdown === "string" ? b.bodyMarkdown : "",
        space: b.space ?? null,
        visibility: b.visibility === "external" ? "external" : "internal",
        slug: typeof b.slug === "string" ? b.slug : undefined,
      });
      res.status(201).json({ page });
    } catch (err) {
      if (err instanceof WikiError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.patch("/pages/:id", (req, res) => {
    const scope = resolveScope(req.user!.id);
    const b = req.body ?? {};
    try {
      const page = updatePage(
        paramId(req.params.id),
        {
          title: b.title,
          bodyMarkdown: b.bodyMarkdown,
          space: b.space,
          visibility:
            b.visibility === "internal" || b.visibility === "external"
              ? b.visibility
              : undefined,
        },
        scope
      );
      res.json({ page });
    } catch (err) {
      if (err instanceof WikiError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.delete("/pages/:id", (req, res) => {
    const scope = resolveScope(req.user!.id);
    try {
      deletePage(paramId(req.params.id), scope);
      res.json({ ok: true });
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
