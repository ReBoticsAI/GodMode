---
name: plugin-authoring
description: Author GodMode Bridge plugins (manifest, ObjectTypes, register hooks, web entry, tenant install)
tools: ["scaffold_plugin", "install_plugin", "list_available_plugins", "prepare_marketplace_submission", "build_plugin", "list_object_types", "git_status", "git_commit", "git_push", "gh_pr_create"]
---
1. Read `docs/PLUGIN_AUTHORING.md` for manifest and register API shape.
2. Prefer declaring **ObjectTypes**, explicit operations/actions, and optional
   `records` seeds in `godmode.plugin.json` before hand-writing routes.
   Vocabulary: ObjectType / Field / Record (not DocType). Call
   `use_skill('object-types')`.
3. `scaffold_plugin` creates `godmode.plugin.json`, `src/bridge.ts`, `src/web.ts`, and package.json under `plugins/<id>/`.
4. Bridge plugin exports `register(api)`; web plugin exports `registerWeb(api)`.
   Executable manifests declare `kernelApiVersion: 1`; Bridge/web clients expose
   `api.kernel.apiVersion === 1`.
   Service-backed ObjectTypes use
   `api.objectTypes.register(definition, adapter)` and implement every declared
   CRUD operation/action.
5. `build_plugin` compiles with Bridge esbuild (`src` → `dist`). No per-plugin `npm install` required.
6. `install_plugin` registers owned ObjectTypes before seeding Records, loads the
   plugin, and enables it for the tenant. Custom routes must enforce tenant and
   installed-plugin checks. No Bridge restart for tools / tenant:install.
7. Declare strict action input/output/error schemas, roles, confirmation,
   idempotency, concurrency, retry, timeout, cancellation, execution mode, and
   sensitive paths; verify terminal `OperationRun` state and tenant isolation.
   Native storage is tenant-local and additive-only; uninstall retains native
   tables and Records.
8. Optional: add catalog entry via Official PR or Unofficial catalog URL.
9. When **Git** / **GitHub** Official plugins are installed, ship code changes with `git_status` → `git_add` → `git_commit` → `git_push` → `gh_pr_create`.
