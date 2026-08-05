---
slug: plugin-pipeline
title: "Intelligence plugin pipeline"
section: "Social and extension"
location: "Chat tools"
summary: "Self-expansion: scaffold_plugin → build_plugin → install_plugin from Intelligence chat."
---
# Intelligence plugin pipeline

![plugin-pipeline in GodMode](/features/plugin-pipeline.png)


Self-expansion path: Intelligence authors plugins through `scaffold_plugin` → optional worktree → promote → `build_plugin` → `install_plugin` for local, hub, or Cloud workspace authoring. Never install from `.worktrees/`. Worktree promote is a local merge for install safety. Shipping the coding root uses core `git_*` tools (see [[coding-stage]]). Domain packs register ObjectTypes, actions, bridge routes, web pages, and install hooks without forking core.

See PLUGIN_AUTHORING docs in the repository and [[objecttype-records]].
