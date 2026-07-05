import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { CoreDatabase } from "../core-db.js";
import { pluginRuntime } from "../plugins/runtime.js";
import {
  installPluginForTenant,
  installedPluginIdsForTenant,
  isPluginEnabledForTenant,
  listAvailablePlugins,
  listInstalledPlugins,
  uninstallPluginForTenant,
} from "../plugins/plugin-install.js";
import { listPluginManifestsForWeb } from "../plugins/loader.js";
import { requireTenantRole, attachAuthContext, requireAuth } from "../services/auth/middleware.js";

function safeSharedExportName(exportName: string): string | null {
  if (exportName.includes("/") || exportName.includes("\\") || exportName.includes("..")) {
    return null;
  }
  const base = exportName.replace(/\.js$/i, "");
  if (!base || !/^[A-Za-z0-9_-]+$/.test(base)) return null;
  return base;
}

function resolveWebBundlePath(pluginId: string): string | null {
  const loaded = pluginRuntime.getPlugin(pluginId);
  if (!loaded) return null;
  const pluginRoot = path.resolve(loaded.pluginRoot);
  const webEntry = loaded.manifest.web?.entry;
  const candidates = [
    ...(webEntry ? [path.join(pluginRoot, webEntry)] : []),
    path.join(pluginRoot, "dist", "web.js"),
  ];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (!resolved.startsWith(pluginRoot + path.sep)) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function resolveSharedExportPath(pluginId: string, exportName: string): string | null {
  const loaded = pluginRuntime.getPlugin(pluginId);
  if (!loaded) return null;
  const safe = safeSharedExportName(exportName);
  if (!safe) return null;
  const pluginRoot = path.resolve(loaded.pluginRoot);
  const candidates = [
    path.join(pluginRoot, "dist", "shared", `${safe}.js`),
    path.join(pluginRoot, "dist", "shared", safe, "index.js"),
  ];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (!resolved.startsWith(pluginRoot + path.sep) && resolved !== pluginRoot) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

export function createPluginsManifestHandler(coreDb: CoreDatabase) {
  return (req: import("express").Request, res: import("express").Response) => {
    const tenantId = req.tenantId;
    const installed = tenantId ? new Set(installedPluginIdsForTenant(coreDb, tenantId)) : null;

    const sharedImports: Record<string, string> = {};
    for (const p of pluginRuntime.loaded) {
      if (installed && !installed.has(p.manifest.id)) continue;
      const sharedDir = path.join(path.resolve(p.pluginRoot), "dist", "shared");
      if (!fs.existsSync(sharedDir)) continue;
      for (const ent of fs.readdirSync(sharedDir, { withFileTypes: true })) {
        if (!ent.isFile() || !ent.name.endsWith(".js")) continue;
        const base = ent.name.replace(/\.js$/i, "");
        if (!base) continue;
        sharedImports[`@godmode-plugin-${p.manifest.id}/${base}`] =
          `/api/plugins/${p.manifest.id}/shared/${ent.name}`;
      }
    }

    const loaded = pluginRuntime.loaded
      .filter((p) => {
        if (!installed) return true;
        return installed.has(p.manifest.id);
      })
      .map((p) => ({
        id: p.manifest.id,
        version: p.manifest.version,
        name: p.manifest.name,
        webBundle: `/api/plugins/${p.manifest.id}/web.js`,
      }));

    res.json({
      plugins: listPluginManifestsForWeb(),
      loaded,
      sharedImports,
    });
  };
}

export function createPluginsRouter(coreDb: CoreDatabase): Router {
  const router = Router();

  router.get("/:id/shared/:export.js", (req, res) => {
    const pluginId = String(req.params.id ?? "").trim();
    const exportName = String(req.params.export ?? "").trim();
    if (!pluginId || !exportName) {
      res.status(400).json({ error: "plugin id and export name required" });
      return;
    }
    const tenantId = req.tenantId;
    if (!tenantId || !isPluginEnabledForTenant(coreDb, tenantId, pluginId)) {
      res.status(404).json({ error: "plugin not installed for tenant" });
      return;
    }
    const bundlePath = resolveSharedExportPath(pluginId, exportName);
    if (!bundlePath) {
      res.status(404).json({ error: "shared export not found" });
      return;
    }
    res.type("application/javascript");
    res.sendFile(bundlePath);
  });

  router.get("/:id/web.js", (req, res) => {
    const pluginId = String(req.params.id ?? "").trim();
    if (!pluginId) {
      res.status(400).json({ error: "plugin id required" });
      return;
    }
    const tenantId = req.tenantId;
    if (!tenantId || !isPluginEnabledForTenant(coreDb, tenantId, pluginId)) {
      res.status(404).json({ error: "plugin not installed for tenant" });
      return;
    }
    const bundlePath = resolveWebBundlePath(pluginId);
    if (!bundlePath) {
      res.status(404).json({ error: "web bundle not found" });
      return;
    }
    res.type("application/javascript");
    res.sendFile(bundlePath);
  });

  router.get("/", (req, res) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "tenant required" });
      return;
    }
    res.json({
      installed: listInstalledPlugins(coreDb, tenantId),
      available: listAvailablePlugins(),
      loaded: pluginRuntime.loaded.map((p) => p.manifest.id),
    });
  });

  router.post("/install", requireTenantRole("owner"), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: "tenant required" });
        return;
      }
      const pluginId = String(req.body?.pluginId ?? "").trim();
      if (!pluginId) {
        res.status(400).json({ error: "pluginId required" });
        return;
      }
      await installPluginForTenant(coreDb, tenantId, pluginId, req.body?.pluginRoot);
      res.json({ ok: true, pluginId });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "install failed",
      });
    }
  });

  router.post("/uninstall", requireTenantRole("owner"), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: "tenant required" });
        return;
      }
      const pluginId = String(req.body?.pluginId ?? "").trim();
      if (!pluginId) {
        res.status(400).json({ error: "pluginId required" });
        return;
      }
      await uninstallPluginForTenant(coreDb, tenantId, pluginId);
      res.json({ ok: true, pluginId });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "uninstall failed",
      });
    }
  });

  return router;
}
