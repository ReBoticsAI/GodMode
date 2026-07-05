---
name: plugin-authoring
description: Author GodMode Bridge plugins (manifest, register hooks, web entry, tenant install)
tools: ["scaffold_plugin", "install_plugin", "list_available_plugins", "prepare_marketplace_submission"]
---
1. Read `docs/PLUGIN_AUTHORING.md` for manifest and register API shape.
2. `scaffold_plugin` creates `godmode.plugin.json`, `src/bridge.ts`, `src/web.ts`, and package.json.
3. Bridge plugin exports `register(api)`; web plugin exports `registerWeb(api)`.
4. After build, set `GODMODE_PLUGIN_PATH` to the plugin root (semicolon-separated on Windows) and restart Bridge.
5. `install_plugin` enables the plugin for the current tenant.
6. Optional: add catalog entry via Official PR or Unofficial catalog URL.
