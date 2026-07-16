/**
 * electron-builder applies the repo .gitignore to extraResources, which would
 * drop `node_modules/`. We stage deps as `_node_modules` and rename here after
 * the app directory is assembled (before NSIS/DMG/AppImage wrapping).
 */
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const runtime = path.join(context.appOutDir, "resources", "runtime");
  const staged = path.join(runtime, "_node_modules");
  const target = path.join(runtime, "node_modules");

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
