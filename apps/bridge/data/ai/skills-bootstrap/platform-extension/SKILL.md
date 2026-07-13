---
name: platform-extension
description: When adding durable platform surface (departments, routes, tools, integrations), scaffold a private Bridge plugin instead of only mutating tenant DB
tools: ["scaffold_plugin", "install_plugin", "list_available_plugins", "prepare_marketplace_submission", "build_plugin"]
---
1. **Plugin first** when the change adds routes, web pages, AI tools, department types, external APIs, or hardware integration.
2. Do **not** only call `create_department` for functional domains — structure belongs in the plugin's `tenant:install` hook.
3. Use `scaffold_plugin` with a kebab-case id and human name. Files land under `plugins/<id>/` inside the coding root (local: repo; hub: tenant workspace). Use returned `codingPath` with `edit_file`.
4. In `src/bridge.ts`, implement `tenant:install` to seed departments/divisions/pages for this plugin's domain.
5. Implement bridge/web entries → `build_plugin` (Bridge esbuild) → `install_plugin` (runtime load + tenant enable). **No** `GODMODE_PLUGIN_PATH` and **no** Bridge restart for tools / `tenant:install`.
6. For public packs, run `prepare_marketplace_submission` and open a PR to GodMode-Marketplace.
7. Kanban/hook loops for **operational** work inside existing surface still use the autonomous-task-runner skill.
8. Advanced Express `api.routes.mount` / `server:beforeListen` after boot may still need a Bridge restart — prefer tools + tenant hooks in v1 scaffolds.
