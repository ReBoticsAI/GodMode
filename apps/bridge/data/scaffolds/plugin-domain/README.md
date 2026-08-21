# __PLUGIN_NAME__

GodMode **domain** plugin scaffold. Business rows use `host.openPluginDb`, not the workspace tenant DB.

## Activate (no Bridge restart)

1. Edit sources under `plugins/__PLUGIN_ID__/`
2. Call Intelligence `build_plugin` (Bridge esbuild)
3. Call Intelligence `install_plugin`

Structure seed may use `getTenantDb` (INSERT OR IGNORE `structure_nodes` only on Community child). Domain tables stay in `plugin-data/{tenant}/__PLUGIN_ID__.sqlite`.
