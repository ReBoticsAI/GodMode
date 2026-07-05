---
name: platform-extension
description: When adding durable platform surface (departments, routes, tools, integrations), scaffold a private Bridge plugin instead of only mutating tenant DB
tools: ["scaffold_plugin", "install_plugin", "list_available_plugins", "prepare_marketplace_submission", "build_plugin"]
---
1. **Plugin first** when the change adds routes, web pages, AI tools, department types, external APIs, or hardware integration.
2. Do **not** only call `create_department` for functional domains — structure belongs in the plugin's `tenant:install` hook.
3. Use `scaffold_plugin` with a kebab-case id and human name; default root is sibling `godmode-plugin-<id>`.
4. In `src/bridge.ts`, implement `tenant:install` to seed departments/divisions/pages for this plugin's domain.
5. Implement bridge/web entries, run `build_plugin`, add path to `GODMODE_PLUGIN_PATH`, restart Bridge, then `install_plugin`.
6. For public packs, run `prepare_marketplace_submission` and open a PR to GodMode-Marketplace.
7. Kanban/hook loops for **operational** work inside existing surface still use the autonomous-task-runner skill.
