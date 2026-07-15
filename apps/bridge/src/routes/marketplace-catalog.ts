import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
  getReqTenantDb,
} from "../services/auth/middleware.js";
import {
  fetchOfficialCatalog,
  fetchUnofficialCatalog,
  listCatalogInstalls,
  listCatalogSources,
  listDiscoveredPluginsForTenant,
  extraPluginPathsFromMeta,
} from "../services/marketplace-catalog.js";
import { getCoreDb } from "../core-db.js";
import { listInstalledPlugins, listAvailablePlugins } from "../plugins/plugin-install.js";

export function createMarketplaceCatalogRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/official", async (_req, res) => {
    try {
      const { url, entries } = await fetchOfficialCatalog();
      res.json({ catalogUrl: url, entries });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load official catalog",
      });
    }
  });

  router.get("/unofficial", async (req, res) => {
    try {
      const core = getCoreDb();
      const sources = listCatalogSources(core, req.user!.id);
      const entries = await fetchUnofficialCatalog(core, req.user!.id);
      const discovered = listDiscoveredPluginsForTenant(core, req.tenantId!);
      const localPaths = extraPluginPathsFromMeta(core);
      res.json({ sources, entries, discovered, localPaths });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load unofficial catalog",
      });
    }
  });

  router.get("/sources", (req, res) => {
    const core = getCoreDb();
    res.json({ sources: listCatalogSources(core, req.user!.id) });
  });

  router.get("/installed", (req, res) => {
    const core = getCoreDb();
    const catalogInstalls = listCatalogInstalls(core, req.tenantId!);
    const plugins = listInstalledPlugins(core, req.tenantId!);
    const available = listAvailablePlugins();
    const discovered = listDiscoveredPluginsForTenant(core, req.tenantId!);
    res.json({ catalogInstalls, plugins, available, discovered });
  });

  return router;
}
