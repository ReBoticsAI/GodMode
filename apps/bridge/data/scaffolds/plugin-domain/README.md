# __PLUGIN_NAME__

GodMode **domain** plugin scaffold. Business rows use `host.openPluginDb`, not the workspace tenant DB.

## Activate (no Bridge restart)

1. Edit sources under `plugins/__PLUGIN_ID__/`
2. Call Intelligence `build_plugin` (Bridge esbuild)
3. Call Intelligence `install_plugin`

Structure seed may use `getTenantDb` (INSERT OR IGNORE `structure_nodes` only on Community child). Domain tables stay in `plugin-data/{tenant}/__PLUGIN_ID__.sqlite`.

## Structure + Welcome

Install seeds:

- Department placeholder
- Welcome page (`kind: __PLUGIN_ID__-welcome`) that lists live `__RECORD_TYPE__` rows via `api.kernel.listRecords`
- Items page (`kind: record-list`, `object_type: __RECORD_TYPE__`) using the host record-list UI

Empty Welcome copy appears only when total is 0.

This scaffold registers ObjectType `__RECORD_TYPE__` with a RecordAdapter over `domain_items` in plugin SQLite.

After install, prove with generated tools (or generics):

- Per-type auto-tools derived from `__RECORD_TYPE__` (for example `create_session_journal_item` / `list_session_journal_items`)
- or `create_record` / `list_records` with `objectType: "__RECORD_TYPE__"`

Do not hand-register CRUD tools for the primary domain table. Use `api.tools.register` only for non-CRUD capabilities.
