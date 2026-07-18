# Plugin authoring

GodMode plugins extend the personal OS with bridge routes, AI tools, web pages, and tenant install hooks.

## Core vs plugins

GodMode core ships as a **complete personal OS** — Intelligence, wiki, tasks, calendar, vault, structure editor, and marketplace install UX. Domain-specific integrations (APIs, hardware, custom workflows) belong in **optional plugins**, not the core tree.

| Layer | Role |
|-------|------|
| **Core** | Auth, tenants, Intelligence, productivity apps, plugin platform APIs |
| **Plugins** | Domain routes, tools, web UI, and install hooks registered at runtime |

Bridge loads plugins from Marketplace-registered paths, Intelligence `install_plugin`, or optional `GODMODE_PLUGIN_PATH`. Web loads plugin bundles from `GET /api/plugins/:id/web.js`. Per-tenant install is gated by the `tenant_plugins` table (**Marketplace → Local**, **Installed**, or Intelligence `install_plugin`).

Fresh clones run as personal OS only until you install plugins from **Marketplace** or scaffold one via Intelligence.

**Model harness profiles** (tool mode, sampling, discovery-tool filters per LLM family) live in Bridge core (`model-profiles/`), not in plugins. Plugins should not try to replace per-model harness behavior — pick a model in Intelligence and GodMode loads that profile automatically. See [LOCAL_LLM.md](./LOCAL_LLM.md#model-harness-profiles-picker-driven).

## Intelligence pipeline (local + hub)

Same tools work in the monorepo and on Docker hub/client:

1. `scaffold_plugin` — creates `plugins/<id>/` under the **coding root** (local: `{repo}/plugins/<id>`; hub/client: `/data/tenant-workspaces/<tenant>/plugins/<id>`). Override with `GODMODE_PLUGIN_SCAFFOLD_DIR`.
2. Edit with `edit_file` using the returned `codingPath` (e.g. `plugins/my-plugin/src/bridge.ts`).
3. `build_plugin` — Bridge **esbuild** compile to `dist/` (no monorepo `workspace:*` / no per-plugin `npm install`).
4. `install_plugin` — append discovery path → runtime `loadPluginFromRoot` (reload on rebuild) → `installPluginForTenant`. **No Bridge restart** for tools and `tenant:install`.

This matches **Marketplace → Local**. Custom Express routes registered via `api.routes.mount` / `server:beforeListen` after boot may still need a restart — scaffolds should prefer tools + tenant hooks.

## Manifest (`godmode.plugin.json`)

```json
{
  "id": "my-plugin",
  "version": "1.0.0",
  "name": "My Plugin",
  "engine": "^0.1.0",
  "kernelApiVersion": 1,
  "departments": ["my-domain"],
  "bridge": { "entry": "dist/bridge.js" },
  "web": { "entry": "dist/web.js" },
  "objectTypes": [
    {
      "name": "Invoice",
      "label": "Invoice",
      "contractVersion": 1,
      "schemaVersion": 1,
      "storage": { "kind": "native" },
      "operations": ["list", "get", "create", "update", "delete"],
      "fields": [
        { "name": "id", "label": "Id", "fieldType": "Data", "required": true },
        { "name": "amount", "label": "Amount", "fieldType": "Float", "required": true }
      ]
    }
  ],
  "records": [
    {
      "objectType": "StructureNode",
      "data": {
        "id": "my-domain",
        "parent_id": null,
        "label": "My Domain",
        "icon": "box",
        "kind": "placeholder"
      }
    }
  ]
}
```

- `engine` — semver range checked against host (`@godmode/plugin-api` `GODMODE_ENGINE_VERSION`). Executable plugins (`bridge` / `web` entry) **must** declare `engine` so release preflight can refuse incompatible platform updates.
- `kernelApiVersion` — executable kernel client contract; current Bridge/web
  clients expose version `1`, and unsupported future versions fail validation
- `bridge.entry` — ESM module exporting `register(api)` or default
- `web.entry` — ESM module exporting `registerWeb(api)` or default
- `objectTypes` — metadata **ObjectTypes** (Fields + storage). Prefer these for CRUD domains. Vocabulary is ObjectType / Field / Record — **not** DocType. See `@godmode/kernel`.
- `records` — declarative Record seeds applied on tenant install (before / with `tenant:install`). Structure shells should prefer seeding `StructureNode` Records here when possible.
- Platform releases do **not** auto-update marketplace plugins unless the signed release manifest pins a coordinated plugin artifact.
- Manifest-native ObjectTypes receive native storage and generic CRUD from
  metadata. Service-backed behavior requires an executable Bridge registration
  that supplies an adapter and implements every declared operation/action.
- Defaults are intentionally narrow: declare supported `operations`, action
  roles, confirmation, idempotency, input/output/error schemas, concurrency,
  execution mode, retry, timeout, cancellation, and sensitive input explicitly.
- `tenantMigrations` is parsed manifest metadata, not a general migration runner.
  Run required versioned migrations from a reviewed lifecycle implementation.

## ObjectType pipeline

```
objectTypes in manifest → validate ownership → tenant-visible registration → native table or adapter → Record/action tools + list/form UI
```

Create shells by seeding `StructureNode` Records and set `object_type` when a
node should render a generic Record page; `segment` remains its URL segment.
Use ObjectType discovery and declared actions for durable mutations. Specialized
static tools are for operational or transport capabilities, not an alternate
durable-write path. Use compiled `bridge.entry` only when metadata is not enough.
## Bridge register

```typescript
import type { GodModePluginRegister } from "@godmode/plugin-api";

export const register: GodModePluginRegister = (api) => {
  api.objectTypes.register(invoiceDefinition, {
    list: (query, ctx) => listInvoices(query, ctx),
    get: (id, ctx) => getInvoice(id, ctx),
    create: (data, ctx) => createInvoice(data, ctx),
    update: (id, data, ctx) => updateInvoice(id, data, ctx),
    delete: (id, ctx) => deleteInvoice(id, ctx),
    actions: {
      approve: (id, input, ctx) => approveInvoice(id, input, ctx),
    },
  });

  api.tools.register([
    { name: "my_tool", description: "…", handler: async (args, ctx) => ({ ok: true }) },
  ]);

  api.hooks.on("tenant:install", async ({ tenantId, host }) => {
    const db = host.getTenantDb(tenantId);
    // Run reviewed migrations or seed service-backed state.
  });

  api.hooks.on("server:beforeListen", (ctx) => {
    const router = ctx.host.createPluginRouter();
    // router.get("/foo", …)
    ctx.app?.use("/api/my-plugin", router);
  });
};
```

`api.objectTypes.register(definition, adapter)` is the executable path for
service-backed ObjectTypes. `PluginRecordAdapter` supports optional `list`,
`get`, `create`, `update`, `delete`, and named `actions`. Every operation/action
declared by the definition must have a matching adapter implementation; do not
declare capabilities the plugin cannot execute.

Bridge and web registrations also receive `api.kernel`, a typed client with
`apiVersion: 1` for discovery, CRUD, and declared actions. Use it instead of
calling removed domain mutation URLs.

A representative action on `invoiceDefinition` is:

```json
{
  "name": "approve",
  "label": "Approve",
  "target": "record",
  "effect": "write",
  "execution": "sync",
  "roles": ["editor", "owner"],
  "confirmation": { "required": true, "ttlSeconds": 300 },
  "idempotency": { "required": true },
  "inputSchema": { "type": "object", "additionalProperties": false }
}
```

HTTP action input is the direct JSON request body. Clients send
`Idempotency-Key`, `If-Match`, and `X-Kernel-Confirmation` headers when required
by the action contract.

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

1. **Intelligence** — `scaffold_plugin` → `build_plugin` → `install_plugin` (runtime load)
2. **Marketplace** — local folder UI, catalog install, or git clone; paths persisted in `platform_meta.marketplace.plugin_paths`
3. `GODMODE_PLUGIN_PATH` — optional env override for advanced setups

There is no automatic sibling-repo discovery in OSS core. Prefer Intelligence or **Marketplace → Local**.

## Per-tenant install

`tenant_plugins` records which plugins a workspace has installed. Bridge gates
manifest access, web bundles, ObjectType visibility, and host-managed plugin
routes on this table. A custom Express route mounted directly by plugin code does
not automatically inherit that check; resolve authentication, tenant membership,
and plugin installation in the route.

Install: Intelligence `install_plugin`, **Marketplace → Local**, or `npm run plugins -- install <id> --tenant <uuid>`.

Only the target plugin's `tenant:install` hook runs (not all plugins).

Definition replacement is ownership checked and atomic; a plugin cannot replace
another plugin's or core's ObjectType/adapter. Core lifecycle state, tenant
seeds, hooks, and knowledge import are durable compensated steps rather than one
cross-database transaction. Record seeds run only after their ObjectTypes are
available. Uninstall removes runtime visibility but deliberately retains native
tables and Records; plugin-owned rules and skills are removed as described
below. Treat retained data as tenant data for backup, export, and erasure.

Mark secret fields and sensitive action input paths so audit records redact them.
Never store credentials in manifest seed Records or source-controlled defaults.

## Build

**Intelligence / Bridge:** `build_plugin` runs esbuild inside Bridge (`src/bridge.ts` → `dist/bridge.js`, optional web entry). `@godmode/plugin-api` and `@godmode/plugin-host` are externalized and linked to the host packages at load time.

**Standalone plugin repos:** use `tsup` or similar to emit `dist/bridge.js` and `dist/web.js`. See your plugin repo's README for a full example.

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
