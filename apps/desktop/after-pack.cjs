/**
 * electron-builder applies the repo .gitignore to extraResources, which would
 * drop `node_modules/`. We stage deps as `_node_modules` and rename here after
 * the app directory is assembled (before NSIS/DMG/AppImage wrapping).
 *
 * On macOS, extraResources land under `GodMode.app/Contents/Resources/`.
 * On Windows/Linux they land under `resources/` next to the executable.
 */
const fs = require("node:fs");
const path = require("node:path");

function resourcesRoot(context) {
  const { appOutDir, electronPlatformName } = context;
  if (electronPlatformName === "darwin") {
    const apps = fs
      .readdirSync(appOutDir)
      .filter((name) => name.endsWith(".app"));
    if (!apps.length) {
      throw new Error(
        `Desktop afterPack: no .app bundle in ${appOutDir} (macOS pack incomplete)`
      );
    }
    return path.join(appOutDir, apps[0], "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

exports.default = async function afterPack(context) {
  const resources = resourcesRoot(context);
  const runtime = path.join(resources, "runtime");
  const staged = path.join(runtime, "_node_modules");
  const target = path.join(runtime, "node_modules");

  if (!fs.existsSync(runtime)) {
    throw new Error(`Desktop afterPack: missing runtime at ${runtime}`);
  }

  if (fs.existsSync(staged)) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    fs.renameSync(staged, target);
  }

  const cors = path.join(target, "cors");
  const bridge = path.join(runtime, "apps", "bridge", "dist", "index.js");
  if (!fs.existsSync(bridge)) {
    throw new Error(`Desktop afterPack: missing Bridge at ${bridge}`);
  }
  if (!fs.existsSync(cors)) {
    throw new Error(
      `Desktop afterPack: runtime node_modules incomplete (missing cors at ${cors}). ` +
        "electron-builder likely stripped dependencies."
    );
  }
};
