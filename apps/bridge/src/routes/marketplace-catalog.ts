import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
  getReqTenantDb,
} from "../services/auth/middleware.js";
import {
  fetchOfficialCatalog,
  fetchCommunityCatalog,
  fetchUnofficialCatalog,
  listCatalogInstalls,
  listCatalogSources,
  listDiscoveredPluginsForTenant,
  extraPluginPathsForTenant,
} from "../services/marketplace-catalog.js";
import { buildPublicOfficialCatalog } from "../services/marketplace-official-catalog.js";
import { getCloudDb } from "../core-db.js";
import { config } from "../config.js";
import { listInstalledPlugins } from "../plugins/plugin-install.js";

export function createMarketplaceCatalogRouter(): Router {
  const router = Router();
  router.use(attachAuthContext, requireAuth, resolveTenant);

  router.get("/official", async (_req, res) => {
    try {
      if (config.isSaas) {
        const index = await buildPublicOfficialCatalog(getCloudDb());
        res.json({
          catalogUrl: "saas-official",
          entries: index.entries,
          version: index.version,
        });
        return;
      }
      const { url, entries } = await fetchOfficialCatalog();
      // Enrich with remote SaaS Official prices when MARKETPLACE_SAAS_OFFICIAL_URL is set.
      let merged = entries;
      const saasUrl = config.marketplace.saasOfficialCatalogUrl;
      if (saasUrl) {
        try {
          const remote = await fetch(saasUrl);
          if (remote.ok) {
            const json = (await remote.json()) as {
              entries?: Array<{ id: string; priceCents?: number; currency?: string }>;
            };
            const byId = new Map((json.entries ?? []).map((e) => [e.id, e]));
            merged = entries.map((e) => {
              const priced = byId.get(e.id);
              return priced
                ? {
                    ...e,
                    priceCents: Number(priced.priceCents ?? 0),
                    currency: priced.currency ?? "usd",
                  }
                : e;
            });
          }
        } catch {
          /* keep free GitHub catalog */
        }
      }
      res.json({ catalogUrl: url, entries: merged });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load official catalog",
      });
    }
  });

  router.get("/community", async (_req, res) => {
    try {
      const { url, entries } = await fetchCommunityCatalog(getCloudDb());
      res.json({ catalogUrl: url, entries });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load community catalog",
      });
    }
  });

  router.get("/unofficial", async (req, res) => {
    try {
      const core = getCloudDb();
      const sources = listCatalogSources(core, req.user!.id);
      const entries = await fetchUnofficialCatalog(core, req.user!.id);
      const discovered = listDiscoveredPluginsForTenant(core, req.tenantId!);
      const localPaths = extraPluginPathsForTenant(core, req.tenantId!);
      res.json({ sources, entries, discovered, localPaths });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to load unofficial catalog",
      });
    }
  });

  router.get("/sources", (req, res) => {
    const core = getCloudDb();
    res.json({ sources: listCatalogSources(core, req.user!.id) });
  });

  router.get("/installed", (req, res) => {
    const core = getCloudDb();
    const catalogInstalls = listCatalogInstalls(core, req.tenantId!);
    const plugins = listInstalledPlugins(core, req.tenantId!);
    const discovered = listDiscoveredPluginsForTenant(core, req.tenantId!);
    const available = discovered.map(({ id, version, name, pluginRoot, loaded }) => ({
      id,
      version,
      name,
      pluginRoot,
      loaded,
    }));
    res.json({ catalogInstalls, plugins, available, discovered });
  });

  return router;
}
