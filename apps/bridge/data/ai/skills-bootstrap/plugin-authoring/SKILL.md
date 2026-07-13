---
name: plugin-authoring
description: Author GodMode Bridge plugins (manifest, register hooks, web entry, tenant install)
tools: ["scaffold_plugin", "install_plugin", "list_available_plugins", "prepare_marketplace_submission", "build_plugin"]
---
1. Read `docs/PLUGIN_AUTHORING.md` for manifest and register API shape.
2. `scaffold_plugin` creates `godmode.plugin.json`, `src/bridge.ts`, `src/web.ts`, and package.json under `plugins/<id>/`.
3. Bridge plugin exports `register(api)`; web plugin exports `registerWeb(api)`.
4. `build_plugin` compiles with Bridge esbuild (`src` → `dist`). No per-plugin `npm install` required.
5. `install_plugin` loads the plugin at runtime and enables it for the current tenant (same pipeline as Marketplace → Unofficial). No Bridge restart for tools / tenant:install.
6. Optional: add catalog entry via Official PR or Unofficial catalog URL.
