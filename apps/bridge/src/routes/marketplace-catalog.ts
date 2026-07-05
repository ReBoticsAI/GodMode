import { Router } from "express";
import {
  attachAuthContext,
  requireAuth,
  resolveTenant,
  getReqTenantDb,
} from "../services/auth/middleware.js";
import {
  addCatalogSource,
  fetchOfficialCatalog,
  fetchUnofficialCatalog,
  installCatalogEntry,
  listCatalogInstalls,
  listCatalogSources,
  removeCatalogSource,
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
      res.json({ sources, entries });
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

  router.post("/sources", (req, res) => {
    const { name, url } = req.body ?? {};
    if (!name || !url) {
      res.status(400).json({ error: "name and url required" });
      return;
    }
    const core = getCoreDb();
    const id = addCatalogSource(core, req.user!.id, String(name), String(url));
    res.status(201).json({ id });
  });

  router.delete("/sources/:id", (req, res) => {
    const core = getCoreDb();
    const ok = removeCatalogSource(core, req.user!.id, String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: "Source not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/installed", (req, res) => {
    const core = getCoreDb();
    const catalogInstalls = listCatalogInstalls(core, req.tenantId!);
    const plugins = listInstalledPlugins(core, req.tenantId!);
    const available = listAvailablePlugins();
    res.json({ catalogInstalls, plugins, available });
  });

  router.post("/install/:entryId", async (req, res) => {
    try {
      const core = getCoreDb();
      const tenantDb = getReqTenantDb(req);
      const result = await installCatalogEntry(core, tenantDb, {
        userId: req.user!.id,
        tenantId: req.tenantId!,
        entryId: String(req.params.entryId),
        sourceCatalog:
          typeof req.body?.sourceCatalog === "string" ? req.body.sourceCatalog : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Install failed",
      });
    }
  });

  return router;
}
