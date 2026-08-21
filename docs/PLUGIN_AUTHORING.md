# Plugin authoring

GodMode plugins extend the Control Center with bridge routes, AI tools, web pages, and tenant install hooks.

## Core vs plugins

GodMode core ships as a **Control Center**: Intelligence, wiki, tasks, calendar, vault, structure editor, and marketplace install UX. Domain-specific integrations (APIs, hardware, custom workflows) belong in **optional plugins**, not the core tree.

| Layer | Role |
|-------|------|
| **Core** | Auth, tenants, Intelligence, productivity apps, plugin platform APIs |
| **Plugins** | Domain routes, tools, web UI, and install hooks registered at runtime |

Bridge loads plugins from Marketplace-registered paths, Intelligence `install_plugin`, or optional `GODMODE_PLUGIN_PATH`. Web loads plugin bundles from `GET /api/plugins/:id/web.js`. Per-tenant install is gated by the `tenant_plugins` table (**Marketplace → Local**, **Installed**, or Intelligence `install_plugin`).

Fresh clones run as Control Center only until you install plugins from **Marketplace** or scaffold one via Intelligence.

**Model harness profiles** (tool mode, sampling, discovery-tool filters per LLM family) live in Bridge core (`model-profiles/`), not in plugins. Plugins should not try to replace per-model harness behavior — pick a model in Intelligence and GodMode loads that profile automatically. See [LOCAL_LLM.md](./LOCAL_LLM.md#model-harness-profiles-picker-driven).

**UI and agent parity:** Prefer declared ObjectType actions (and generated tools) over new static mutation tools. Community catalog publish uses `MarketplaceCatalog.prepare_submission` / `submit_submission` (Sell UI and Intelligence aliases / generated tools). See [OBJECTTYPE_KERNEL.md](./OBJECTTYPE_KERNEL.md#ui-and-agent-parity) and [AI_TOOL_KERNEL_PARITY.md](./AI_TOOL_KERNEL_PARITY.md).

## Intelligence pipeline (local + hub)

Same tools work in the monorepo and on Docker hub/client:

1. `scaffold_plugin` — creates `plugins/<id>/` under the **active coding root** (local: `{repo}/plugins/<id>`; hub/client: `{tenant-workspace}/plugins/<id>`, or under `{tenant}/.worktrees/<slug>/plugins/<id>` when `agent.config.workspace` points at a Layer 2 worktree). Override with `GODMODE_PLUGIN_SCAFFOLD_DIR`.
2. Edit with `edit_file` using the returned `codingPath` (e.g. `plugins/my-plugin/src/bridge.ts`). Use `coding_worktree_create` to isolate iterative edits, then `coding_worktree_promote` to merge into the live tenant tree (and optionally discard). `install_plugin` **refuses** paths under `.worktrees/`. Promote first, then install from live `plugins/<id>`. To ship the coding root itself: `git_status` → optional `git_branch` → `git_diff` → `git_add` → `git_commit` → `git_push` (confirm; no force-push). Opening a review request on an external host is a separate Official GitHub plugin tool when installed.
3. `build_plugin` — Bridge **esbuild** compile to `dist/` (no monorepo `workspace:*` / no per-plugin `npm install`). For native/`npm ci` deps when Layer 4 is enabled, use `run_ephemeral_build` (host build supervisor; Docker socket never on Bridge).
4. `install_plugin` — append discovery path → runtime `loadPluginFromRoot` (reload on rebuild) → `installPluginForTenant`. **No Bridge restart** for tools, `tenant:install`, and `api.routes.mount` HTTP routes. Failures return a class (`manifest`, `build`, `isolation`, `install`) and surface in Attention.

Plugins hot-reload in process. Bridge **Core** (`apps/bridge`) does not: local `tsx watch` kills the process on a Core save. Intelligence turns persist `turn_state` on the chat and auto-continue once after the new process listens. Do not replay completed file or git tools. If resume itself crashes, the next boot fail-closes that turn instead of looping.

### SaaS coding isolation (#112 / #178)

On SaaS (`INSTALLATION_SURFACE=saas`), coding UI and agent coding tools are **on by
default** (#178). Opt out with `PLATFORM_SAAS_ALLOW_CODE_ACCESS=false`. Arbitrary
**Local** plugin folder registration stays **off** unless
`PLATFORM_SAAS_ALLOW_LOCAL_PLUGINS=true`. Tenants still author via Intelligence
`scaffold_plugin` under the tenant workspace coding root (`install_plugin` there is
not local-folder registration) and can also install Official / Community packs.

Coding tools are confined so tenants cannot reach core or each other:

| Layer | Boundary |
|-------|----------|
| 1 | Coding root = `tenant-workspaces/<tenantId>/` only |
| 2 | Optional Bridge-owned `.worktrees/<slug>`; promote into live tree before install |
| 3 | `run_terminal` / PTY / helpers under bubblewrap; network `none` or allowlist |
| 4 | Optional ephemeral npm builds via host supervisor (`CODING_BUILD_MODE=ephemeral`); build net `none` or `allowlist` (#167) |

Intelligence tool cards show sandbox / net / worktree badges when tools return isolation metadata. Full threat model: [SECURITY.md](./SECURITY.md).

This matches **Marketplace → Local** on non-SaaS hosts. Prefer `api.routes.mount` in `register` for Express routes (hot-reloads via route slots). Avoid raw `ctx.app.use` in `server:beforeListen`; that path cannot be swapped on reload. If you must mount from the hook, use `ctx.host.mountPluginRoute(pluginId, path, router)`.

## Manifest (`godmode.plugin.json`)

```json
{
  "id": "my-plugin",
  "version": "1.0.0",
  "name": "My Plugin",
  "engine": "^0.1.0",
  "kernelApiVersion": 1,
  "departments": ["my-domain"],
  "capabilities": {
    "network": { "hosts": ["api.example.com"] },
    "tools": { "names": ["search_docs"] },
    "records": { "names": ["Invoice", "StructureNode"] }
  },
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
- `capabilities.network.hosts` — optional hostnames for Marketplace buyer
  grants (#290). Official/Community installs deny external egress unless these
  (and/or catalog `networkHosts`) are present. Call `api.host.externalFetch`
  rather than raw `fetch`. Local/operator installs are unrestricted.
- `capabilities.tools.names` — optional AI tool names the plugin may register
  via `api.tools.register` (#303). `capabilities.tools: ["ping"]` is accepted as
  the same grant list. Catalog may also set `toolNames`.
- `capabilities.records.names` — optional ObjectType names the plugin may
  register (`api.objectTypes.register`) or call via `api.kernel` (#303). Catalog
  may also set `recordNames`. Manifest `objectTypes` names are collected into
  the records grant at install. Official/Community deny tools/records by default.
- **Runtime isolation:** Official/Community still load in-process today.
  Community Cloud installs are designed to move to a child process
  ([PLUGIN_ISOLATION.md](PLUGIN_ISOLATION.md)). Call `api.host.externalFetch`
  rather than raw `fetch` either way.
- **Official connectors** (Vault Connect + Official catalog plugins that talk to
  external hosts) must also meet [OFFICIAL_CONNECTORS.md](OFFICIAL_CONNECTORS.md):
  auth, refresh, scopes, webhooks when inbound, rate-limit / failure UX,
  teardown, Cloud pins, and docs. GitHub is the reference. Publisher/store
  consoles also register on the [connector catalog](features/publisher-store-connector-pattern.md)
  (`api.publisherConnectors.register`) so Intelligence can install them.
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

  api.publisherConnectors.register([
    {
      id: "my-store",
      title: "My Store",
      description: "Draft listing submit + metrics.",
      kind: "store",
      source: "plugin",
      installHint: "Install this pack, then connect in Vault.",
      tools: { submit: "my_store_submit", list: "my_store_list" },
      neverAutoApprove: ["my_store_submit"],
    },
  ]);

  api.hooks.on("tenant:install", async ({ tenantId, host }) => {
    // Official/local: live tenant SQLite. Community: structure-seed stub only
    // (INSERT OR IGNORE INTO structure_nodes over IPC). Prefer manifest records
    // or api.kernel.create("StructureNode", data, ctx) when StructureNode is granted.
    const db = host.getTenantDb(tenantId);
    // Run reviewed migrations or seed service-backed state.
  });

  // Prefer mount in register (hot-reloads without Bridge restart):
  const router = api.host.createPluginRouter();
  // router.get("/foo", …)
  api.routes.mount("/api/my-plugin", router);

  // Legacy: if you must use the listen hook, prefer mountPluginRoute over app.use:
  // api.hooks.on("server:beforeListen", (ctx) => {
  //   const r = ctx.host.createPluginRouter();
  //   ctx.host.mountPluginRoute?.(api.manifest.id, "/api/my-plugin", r);
  // });
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
| `getTenantDb(tenantId)` | Tenant-scoped SQLite in-process. Community child: INSERT OR IGNORE INTO structure_nodes only (no live handle) |
| `getReqTenantDb(req)` | SQLite from authenticated request |
| `openPluginDb(pluginId, tenantId)` | Plugin-private SQLite at `{dataDir}/plugin-data/{tenantId}/{pluginId}.sqlite` (not the workspace core DB). Required on in-process Bridge hosts; community child may deny. |
| `createPluginRouter()` | Express router with tenant middleware |
| `mountPluginRoute(pluginId, path, router)` | Slot-based HTTP mount (hot-reload safe) |
| `getTimeseriesStore()` | Platform analytics DuckDB (telemetry only; not market ticks) |
| `bootstrapTradingDepartment(db)` | Upsert a department shell node (plugin install hooks) |
| `bridgeFetch(path)` | Internal HTTP to Bridge |

Plugins must **not** import from `apps/bridge/src/**`.

## Persistence

Choose the store explicitly:

| Data | Store |
|------|--------|
| Structure, install/lifecycle, kernel ObjectType registration | Workspace tenant SQLite (`getTenantDb` / `getReqTenantDb`) |
| Core personal-OS Records (notes, tasks, calendar-style entities the product owns) | Workspace tenant SQLite via ObjectTypes / Records |
| Plugin domain / business rows (sessions, blueprints, calculators, playbooks-style state) | `host.openPluginDb(pluginId, tenantId)` → `plugin-data/{tenantId}/{pluginId}.sqlite` |
| High-volume specialized series (when SQLite is wrong) | Plugin-owned specialized store (still outside Core) |

Rules:

- Do not `CREATE TABLE` plugin business schema on the workspace DB. Structure seed allowlist for `structure_nodes` is the exception.
- ObjectType adapters may façade into plugin SQLite; they must not create domain tables on the tenant SQLite.
- Do not use browser `.log` downloads/pickers or `localStorage` for durable plugin state.
- After reinstall or reset, existing plugin SQLite files may be dirty: migrate the schema or delete and recreate.

```typescript
export const register: GodModePluginRegister = (api) => {
  const { host } = api;
  api.hooks.on("tenant:install", ({ tenantId }) => {
    const db = host.openPluginDb("my-plugin", tenantId) as import("better-sqlite3").Database;
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  });
};
```


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

### Host UI and singletons (`@godmode/web-host`)

Plugins must share the **same** React and UI instances as the main app. Import host presentational shadcn components and singletons from `@godmode/web-host` (not `@/components/ui` on SaaS, and never bundle a second copy via a `@/` alias):

```typescript
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  cn,
  StructureTabGroupPage,
} from "@godmode/web-host";
```

Curated v1 exports: `cn`, `Button` / `buttonVariants`, `Card` (+ header/title/description/content/footer/action), `Empty` (+ header/title/description/content/media), `Badge` / `badgeVariants`, `Alert` (+ title/description/action), `Separator`, `Skeleton`, `Tabs` (+ list/trigger/content), plus `StructureTabGroupPage`, `pageElementFor`, `webPluginRuntime`.

Intelligence `build_plugin` externalizes `@godmode/web-host`, `react`, `react/jsx-runtime`, `react-dom`, `react-router-dom`, `lucide-react`, and `sonner` so the host import map resolves them. For Marketplace `tsup`, add the same modules to your web `external` list.

Call `use_skill('shadcn-ui')` for tokens and composition rules. Do **not** hand-roll Card/Button/Empty shells and call them shadcn. Do **not** adopt third-party UI kits.

**Working UX checklist (ship blockers):**
- Primary `Button`s must navigate, dismiss, or mutate (`onClick`, router `Link`/`navigate`, or form submit). Decorative Got it / Get started labels are incomplete.
- Seed Structure departments **with** divisions/pages that match registered page kinds. An empty department overview is not a product surface.
- Prefer host `record-list` / `record-form` for CRUD. Archive / history pages need an ObjectType field or action and a filtered list; omit the page until wired.
- After `build_plugin` + `install_plugin`, confirm Structure paths render real UI (not `placeholder`) before claiming done.

**Full monorepo / Marketplace tsup:** Presentational `@/` imports may still work when aliases are configured. Prefer `@godmode/web-host` for anything that must match host chrome. Never bundle host singletons via `@/`.

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
