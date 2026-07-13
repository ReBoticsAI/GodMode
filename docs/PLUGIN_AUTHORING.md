# Plugin authoring

GodMode plugins extend the personal OS with bridge routes, AI tools, web pages, and tenant install hooks.

## Core vs plugins

GodMode core ships as a **complete personal OS** — Intelligence, wiki, tasks, calendar, vault, structure editor, and marketplace install UX. Domain-specific integrations (APIs, hardware, custom workflows) belong in **optional plugins**, not the core tree.

| Layer | Role |
|-------|------|
| **Core** | Auth, tenants, Intelligence, productivity apps, plugin platform APIs |
| **Plugins** | Domain routes, tools, web UI, and install hooks registered at runtime |

Bridge loads plugins from Marketplace-registered paths or optional `GODMODE_PLUGIN_PATH`. Web loads plugin bundles from `GET /api/plugins/:id/web.js`. Per-tenant install is gated by the `tenant_plugins` table (**Marketplace → Unofficial** or **Installed**).

Fresh clones run as personal OS only until you install plugins from **Marketplace**.

**Model harness profiles** (tool mode, sampling, discovery-tool filters per LLM family) live in Bridge core (`model-profiles/`), not in plugins. Plugins should not try to replace per-model harness behavior — pick a model in Intelligence and GodMode loads that profile automatically. See [LOCAL_LLM.md](./LOCAL_LLM.md#model-harness-profiles-picker-driven).

## Manifest (`godmode.plugin.json`)

```json
{
  "id": "my-plugin",
  "version": "1.0.0",
  "name": "My Plugin",
  "engine": "^0.1.0",
  "departments": ["my-domain"],
  "bridge": { "entry": "dist/bridge.js" },
  "web": { "entry": "dist/web.js" }
}
```

- `engine` — semver range checked against host (`@godmode/plugin-api` `GODMODE_ENGINE_VERSION`)
- `bridge.entry` — ESM module exporting `register(api)` or default
- `web.entry` — ESM module exporting `registerWeb(api)` or default

## Bridge register

```typescript
import type { GodModePluginRegister } from "@godmode/plugin-api";

export const register: GodModePluginRegister = (api) => {
  api.tools.register([
    { name: "my_tool", description: "…", handler: async (args, ctx) => ({ ok: true }) },
  ]);

  api.hooks.on("tenant:install", async ({ tenantId, host }) => {
    const db = host.getTenantDb(tenantId);
    // seed structure, run migrations
  });

  api.hooks.on("server:beforeListen", (ctx) => {
    const router = ctx.host.createPluginRouter();
    // router.get("/foo", …)
    ctx.app?.use("/api/my-plugin", router);
  });
};
```

## Host SDK (`@godmode/plugin-host`)

Injected at boot via `api.host`:

| Method | Purpose |
|--------|---------|
| `getTenantDb(tenantId)` | Tenant-scoped SQLite |
| `getReqTenantDb(req)` | SQLite from authenticated request |
| `createPluginRouter()` | Express router with tenant middleware |
| `getTimeseriesStore()` | Analytics / DuckDB queries |
| `bootstrapTradingDepartment(db)` | Upsert a department shell node (plugin install hooks) |
| `bridgeFetch(path)` | Internal HTTP to Bridge |

Plugins must **not** import from `apps/bridge/src/**`.

## Web register

```typescript
import type { GodModeWebPluginRegister } from "@godmode/plugin-api";

export const registerWeb: GodModeWebPluginRegister = (api) => {
  api.pageKinds.register([{ kind: "my-page", component: MyPage }]);
  api.routes.register([{ path: "/my/route", element: <MyPage /> }]);
  api.shell.contribute([{ id: "sidebar", rightSidebar: "my-plugin", component: MySidebar }]);
};
```

Web bundles are served at `GET /api/plugins/:id/web.js` and loaded via dynamic import (with an import map for shared dependencies).

### Shared dependencies (import map)

The host serves a browser import map so plugin bundles share one copy of React, the router, and other heavy libraries. In `tsup`, **externalize** at least:

- `react`, `react-dom`, `react-router-dom`
- `@godmode/plugin-api`, `@godmode/web-host`
- `lucide-react`, `sonner`, `@xyflow/react`, `@godmode/flow-core`, `recharts`
- `use-sync-external-store` and its `/shim` subpaths

Do not bundle these into `dist/web.js` — the host resolves them at runtime.

### Host singletons (`@godmode/web-host`)

Some host modules must be the **same instance** as the main app (plugin page registry, structure tabs, React context). If you bundle them via a `@/` alias, you get a second copy and tab pages fall back to placeholders.

Import host singletons from `@godmode/web-host` instead of `@/…`:

```typescript
import { StructureTabGroupPage } from "@godmode/web-host";
```

Add `"@godmode/web-host"` to your web `external` list in `tsup.config.ts`. You may still use `@/` for presentational imports (buttons, cards, `PageHeader`) that do not carry cross-bundle singleton state.

Define `import.meta.env.*` in the web build if you bundle host `@/api` code — the host inlines those at compile time; plugin bundles do not.

## Discovery

1. **Marketplace** — local folder UI, catalog install, or git clone; paths persisted in `platform_meta.marketplace.plugin_paths`
2. `GODMODE_PLUGIN_PATH` — optional env override for advanced setups

There is no automatic sibling-repo discovery in OSS core. Clone plugins yourself or add them under **Marketplace → Unofficial**.

## Per-tenant install

`tenant_plugins` records which plugins a workspace has installed. Bridge gates manifest, web bundles, and routes on this table.

Install: **Marketplace → Unofficial** (local folder, catalog entry, or discovered plugin) or `npm run plugins -- install <id> --tenant <uuid>`.

Only the target plugin's `tenant:install` hook runs (not all plugins).

## Build

Use `tsup` or similar to emit `dist/bridge.js` and `dist/web.js`. See your plugin repo's README for a full example.

Web bundles load at runtime from `GET /api/plugins/:id/web.js` via dynamic import and the host import map — no `@/` aliases in the core Vite app are required at plugin build time except where your repo uses them locally via `tsup` `esbuildOptions.alias`.

### Plugin knowledge (`data/ai/`)

Ship optional Intelligence rules and skills inside the plugin repo:

```
data/ai/rules/*.mdc
data/ai/skills/<id>/SKILL.md
```

On **tenant install**, core imports these into the tenant SQLite (`ai_rules` / `ai_skills`) with `source_plugin_id` set. On **uninstall**, they are removed automatically. You do not copy files into `apps/bridge/data/ai/` manually.

`.mdc` files are the **authoring format** (easy to review in git, same shape as Cursor rules). The Bridge **imports them into the database** on first knowledge load and on plugin install; runtime reads from SQLite, not the filesystem.

Core ships generic bootstrap rules in `apps/bridge/data/ai/rules-bootstrap/`. Domain rules belong in the plugin that owns that domain (e.g. a trading or analytics integration plugin).

## Packages

During development, depend on core packages via workspace link:

```json
"@godmode/plugin-api": "file:../../GodMode/packages/plugin-api",
"@godmode/plugin-host": "file:../../GodMode/packages/plugin-host"
```
