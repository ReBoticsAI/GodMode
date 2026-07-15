---
name: platform-extension
description: When adding durable platform surface (ObjectTypes, departments, routes, tools, integrations), scaffold a Bridge plugin
tools: ["scaffold_plugin", "install_plugin", "list_available_plugins", "prepare_marketplace_submission", "build_plugin", "list_object_types", "create_record"]
---
1. **Plugin first** when the change adds ObjectTypes, routes, web pages, AI tools, department types, external APIs, or hardware integration.
2. Do **not** only call `create_department` for functional domains — declare StructureNode / domain Records in manifest `records` or seed them in `tenant:install`.
3. Prefer manifest-native `objectTypes` for straightforward tenant CRUD. Use
   `api.objectTypes.register(definition, adapter)` for service-backed CRUD or
   named actions and implement every declared capability. See skill
   `object-types`.
4. Use `scaffold_plugin` with a kebab-case id and human name. Files land under `plugins/<id>/` inside the coding root.
5. Implement bridge/web entries → `build_plugin` → `install_plugin`.
6. For public packs, run `prepare_marketplace_submission` and open a PR to GodMode-Marketplace.
7. Custom Express routes must enforce authentication, tenant membership, and
   installed-plugin visibility explicitly. Advanced mounts after boot may still
   need a Bridge restart — prefer tools + ObjectTypes + tenant hooks in v1.
