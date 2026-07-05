# Plugin authoring

GodMode plugins extend the personal OS with bridge routes, AI tools, web pages, and tenant install hooks.

## Core vs plugins

GodMode core ships as a **complete personal OS** — Intelligence, wiki, tasks, calendar, vault, structure editor, and marketplace install UX. Domain-specific integrations (APIs, hardware, custom workflows) belong in **optional plugins**, not the core tree.

| Layer | Role |
|-------|------|
| **Core** | Auth, tenants, Intelligence, productivity apps, plugin platform APIs |
| **Plugins** | Domain routes, tools, web UI, and install hooks registered at runtime |

Bridge loads plugins from `GODMODE_PLUGIN_PATH` or marketplace install paths. Web loads plugin bundles from `GET /api/plugins/:id/web.js`. Per-tenant install is gated by the `tenant_plugins` table (Settings → Plugins).

Fresh clones run as personal OS only until you install plugins from Marketplace or set `GODMODE_PLUGIN_PATH`.

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

Web bundles are served at `GET /api/plugins/:id/web.js` and loaded via dynamic import.

## Discovery

1. `GODMODE_PLUGIN_PATH` — semicolon-separated paths (Windows) for non-standard layouts
2. Marketplace install — paths persisted in `platform_meta.marketplace.plugin_paths`
3. **Settings → Plugins** — per-tenant install from discovered roots

There is no automatic sibling-repo discovery in OSS core. Clone plugins yourself or install from Marketplace.

## Per-tenant install

`tenant_plugins` records which plugins a workspace has installed. Bridge gates manifest, web bundles, and routes on this table.

Install: Settings → Plugins or `npm run plugins -- install <id> --tenant <uuid>`.

Only the target plugin's `tenant:install` hook runs (not all plugins).

## Build

Use `tsup` or similar to emit `dist/bridge.js` and `dist/web.js`. See your plugin repo's README for a full example.

Web bundles load at runtime from `GET /api/plugins/:id/web.js` via dynamic import — no core Vite aliases required.

## Packages

During development, depend on core packages via workspace link:

```json
"@godmode/plugin-api": "file:../../GodMode/packages/plugin-api",
"@godmode/plugin-host": "file:../../GodMode/packages/plugin-host"
```
