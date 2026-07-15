import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { CoreDatabase } from "../core-db.js";
import { pluginRuntime } from "../plugins/runtime.js";
import {
  installedPluginIdsForTenant,
  isPluginEnabledForTenant,
  listAvailablePlugins,
  listInstalledPlugins,
} from "../plugins/plugin-install.js";
import { listPluginManifestsForWeb } from "../plugins/loader.js";

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

function resolveDistAssetPath(pluginId: string, filename: string): string | null {
  const loaded = pluginRuntime.getPlugin(pluginId);
  if (!loaded) return null;
  if (!/^[A-Za-z0-9_.-]+\.(js|map|css)$/.test(filename)) return null;
  const pluginRoot = path.resolve(loaded.pluginRoot);
  const distDir = path.join(pluginRoot, "dist");
  const resolved = path.resolve(distDir, filename);
  if (!resolved.startsWith(distDir + path.sep) && resolved !== distDir) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
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

function resolvePluginPackagePath(pluginId: string, pkgName: string): string | null {
  const loaded = pluginRuntime.getPlugin(pluginId);
  if (!loaded) return null;
  const safe = pkgName.replace(/\.js$/i, "").trim();
  if (!safe || !/^[A-Za-z0-9_-]+$/.test(safe)) return null;
  const pluginRoot = path.resolve(loaded.pluginRoot);
  const candidates = [
    path.join(pluginRoot, "packages", safe, "dist", "index.js"),
    path.join(pluginRoot, "node_modules", "@godmode", safe, "dist", "index.js"),
  ];
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (!resolved.startsWith(pluginRoot + path.sep)) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function discoverPluginPackageImports(
  pluginRoot: string,
  pluginId: string
): Record<string, string> {
  const out: Record<string, string> = {};
  const root = path.resolve(pluginRoot);
  const packagesDir = path.join(root, "packages");
  if (!fs.existsSync(packagesDir)) return out;
  for (const ent of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dist = path.join(packagesDir, ent.name, "dist", "index.js");
    if (!fs.existsSync(dist)) continue;
    out[`@godmode/${ent.name}`] = `/api/plugins/${pluginId}/packages/${ent.name}.js`;
  }
  return out;
}

export function createPluginsManifestHandler(coreDb: CoreDatabase) {
  return (req: import("express").Request, res: import("express").Response) => {
    const tenantId = req.tenantId;
    const installed = tenantId ? new Set(installedPluginIdsForTenant(coreDb, tenantId)) : null;

    const sharedImports: Record<string, string> = {};
    const packageImports: Record<string, string> = {};
    for (const p of pluginRuntime.loaded) {
      if (installed && !installed.has(p.manifest.id)) continue;
      Object.assign(packageImports, discoverPluginPackageImports(p.pluginRoot, p.manifest.id));
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
      packageImports,
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

  router.get("/:id/packages/:pkg.js", (req, res) => {
    const pluginId = String(req.params.id ?? "").trim();
    const pkgName = String(req.params.pkg ?? "").trim();
    if (!pluginId || !pkgName) {
      res.status(400).json({ error: "plugin id and package name required" });
      return;
    }
    const tenantId = req.tenantId;
    if (!tenantId || !isPluginEnabledForTenant(coreDb, tenantId, pluginId)) {
      res.status(404).json({ error: "plugin not installed for tenant" });
      return;
    }
    const bundlePath = resolvePluginPackagePath(pluginId, pkgName);
    if (!bundlePath) {
      res.status(404).json({ error: "plugin package not found" });
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

  router.get("/:id/:filename", (req, res, next) => {
    const pluginId = String(req.params.id ?? "").trim();
    const filename = String(req.params.filename ?? "").trim();
    if (!pluginId || !filename || filename === "web.js") {
      next();
      return;
    }
    const tenantId = req.tenantId;
    if (!tenantId || !isPluginEnabledForTenant(coreDb, tenantId, pluginId)) {
      res.status(404).json({ error: "plugin not installed for tenant" });
      return;
    }
    const assetPath = resolveDistAssetPath(pluginId, filename);
    if (!assetPath) {
      next();
      return;
    }
    if (filename.endsWith(".map")) {
      res.type("application/json");
    } else if (filename.endsWith(".css")) {
      res.type("text/css");
    } else {
      res.type("application/javascript");
    }
    res.sendFile(assetPath);
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

  return router;
}
