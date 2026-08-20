---
name: plugin-authoring
description: Author and install GodMode Bridge plugins (scaffold, ObjectTypes, register, build, tenant install). Use for any durable platform surface or integration.
tools: ["scaffold_plugin", "install_plugin", "list_available_plugins", "prepare_community_catalog_submission", "submit_community_catalog_submission", "build_plugin", "list_object_types", "create_record", "git_status", "git_commit", "git_push", "git_clone", "github_pr_create"]
---
Use when the change adds ObjectTypes, routes, web pages, AI tools, department types, external APIs, or hardware. Do not only call `create_department` for functional domains.

1. Read `docs/PLUGIN_AUTHORING.md` for manifest and register API shape.
2. Prefer declaring **ObjectTypes**, operations/actions, and optional `records` seeds in `godmode.plugin.json`. Vocabulary: ObjectType / Field / Record (not DocType). Call `use_skill('object-types')` for metadata detail.
3. `scaffold_plugin` with a kebab-case id creates `godmode.plugin.json`, `src/bridge.ts`, `src/web.tsx`, and package.json under `plugins/<id>/`.
4. Bridge exports `register(api)`; web exports `registerWeb(api)`. Executable manifests declare `kernelApiVersion: 1`. Service-backed ObjectTypes use `api.objectTypes.register(definition, adapter)` and implement every declared capability.
5. Seed StructureNode / domain Records in manifest `records` or `tenant:install`, then `build_plugin` → `install_plugin` (no Bridge restart for tools, ObjectTypes, `api.routes.mount`, or tenant:install). Community Cloud installs have no live SQLite handle; `tenant:install` may `INSERT OR IGNORE INTO structure_nodes` (host IPC) or `api.kernel.create("StructureNode", ...)` when that ObjectType is granted.
6. Web UI: call `use_skill('shadcn-ui')` for tokens/composition. Import host shadcn from `@godmode/web-host` (`Button`, `Card`, `Empty`, `Badge`, `Alert`, `Tabs`, `Separator`, `Skeleton`, `cn`, …). Do not import `@/components/ui` on Intelligence/SaaS (no `apps/web`). Do not invent parallel UI kits or hand-rolled Card/Button/Empty trees.
7. **Working UX (required before done):** Primary Buttons need `onClick`, `Link`, or form submit (no decorative Got it / Get started). Seed Structure pages that match registered page kinds (not empty department overviews). Archive / history pages need an ObjectType field or action plus a filtered list; omit the page until wired. Prefer host `record-list` for CRUD lists. Verify: `build_plugin` → `install_plugin` → `list_structure` → create or update one Record when the ask includes content.
8. Custom Express routes must enforce authentication, tenant membership, and installed-plugin visibility. Prefer tools + ObjectTypes + tenant hooks when HTTP is unnecessary.
9. Declare strict action schemas/policies (roles, confirmation, idempotency, concurrency, retry, timeout, cancellation). Verify `OperationRun` terminal state and tenant isolation.
10. For public Community packs: Sell → **Submit to Community catalog** or `prepare_community_catalog_submission` / `submit_community_catalog_submission` (same Bridge path as the Sell wizard). Use git/GitHub tools only for plugin development, not catalog shipping.
11. Ship coding-root changes with `git_*` tools; use Official GitHub plugin tools for PRs when installed.
12. After `use_skill('plugin-authoring')`, prefer `scaffold_plugin` (or edit under `plugins/<id>/`) over long host-repo archaeology. Few explore tools before the first write on Tier-2 asks.
