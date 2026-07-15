---
name: object-types
description: Define and use GodMode ObjectTypes (metadata) — Fields, Records, auto CRUD — not DocTypes
tools: ["list_object_types", "list_records", "get_record", "create_record", "update_record", "delete_record", "run_record_action", "list_structure", "create_department", "create_division", "create_page"]
---
# ObjectTypes (metadata kernel)

GodMode extends through **ObjectTypes**, not compiled one-offs when possible.

## Vocabulary

- **ObjectType** — fields, access policy, explicit operations/actions, storage,
  `contractVersion`, and `schemaVersion`
- **Field** — property on an ObjectType
- **Record** — one row/instance

Never say DocType. Structure uses ObjectType **StructureNode**; department/division/page are tree roles.

## Pipeline

1. Prefer existing ObjectTypes: `list_object_types`.
2. Shell tree: prefer **StructureNode** Records via `create_record`
   (`objectType: StructureNode`); legacy structure tools are compatibility
   wrappers.
3. Domain data: plugins ship `objectTypes` + `records` seeds in `godmode.plugin.json`; compiled `bridge.entry` only when metadata is not enough.
4. Generic tools: use declared CRUD tools and `run_record_action` with
   `objectType` set; inspect metadata before mutating.
5. For page kinds `record-list` / `record-form`,
   `StructureNode.object_type` selects the ObjectType and `segment` remains the
   URL segment.
6. Honor action schemas, roles, confirmation, idempotency, concurrency, and
   sensitive-input metadata. Async actions return an `OperationRun`.
7. Plugin ObjectTypes are visible only to tenants where their owner is installed.

## Tiering

- **Tier 1:** StructureNode shells + wiki + tasks — native tools.
- **Tier 2:** New ObjectTypes via plugin scaffold + `objectTypes` in the manifest.

One tool call at a time; confirm results before continuing.
