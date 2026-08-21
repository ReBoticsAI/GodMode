# __PLUGIN_NAME__

GodMode **records** plugin scaffold. Use only for Core personal-OS entities the product owns (notes/tasks-style). Rows live as workspace ObjectType Records, not plugin business SQLite.

For plugin-owned domain data (sessions, journals the plugin owns, blueprints), use `scaffold_plugin` with `template: "domain"` instead.

## Activate (no Bridge restart)

1. Edit sources under `plugins/__PLUGIN_ID__/`
2. Call Intelligence `build_plugin`
3. Call Intelligence `install_plugin`
