# Plugin runtime isolation

Capability grants (#290 / #303) are least privilege on `host.externalFetch`,
tool registration, and kernel/ObjectType access. They are **not** a sandbox by
themselves. Community marketplace installs additionally run in a Bridge-supervised
child process (#559). Official / local / operator plugins stay in-process.

This is the design note for [#314](https://github.com/ReBoticsAI/GodMode/issues/314)
and the Community runner in [#559](https://github.com/ReBoticsAI/GodMode/issues/559).

**Not this document:** coding-job isolation (Layers 1–4, bubblewrap terminal,
Cursor SDK sandbox, ephemeral Docker builds). That surface is [SECURITY.md](SECURITY.md)
and [#112](https://github.com/ReBoticsAI/GodMode/issues/112) / [#172](https://github.com/ReBoticsAI/GodMode/issues/172).
Do not reuse the coding jail as the plugin runtime.

## What ships today (keep forever)

- **Intake CI** pins and verifies Community (and Official) listings before they hit the shelf.
- **Buyer install pins** (#177) stop floating `main` after intake.
- **In-process capability grants** deny network, tools, and records unless named at install (`godmode.capabilities.json`).
- Official and Community use the **same deny-by-default grant modes**. Local / operator paths stay unrestricted.
- Marketplace trees missing a grants file **fail closed** (deny).
- **Community** (`trustTier === "community"`) loads in a **child process**. Bridge talks JSON-RPC and re-checks grants on every host/tool/kernel call. The child never gets a live SQLite handle or the Bridge Express `app`.
- **Official / local / operator** still **`import()` into Bridge**. Grants do not stop raw `fetch`, Node `fs` / `child_process`, shared heap, or `getPluginHost()` on those tiers.
- Unexpected Community child exit surfaces Attention (`plugin_loop`) and drops the loaded plugin. Bridge stays up. Unregister and hot-reload kill then respawn the child. Spawn failure fails closed (no in-process fallback).
- Plugin `web.js` is still served by Bridge. Browser bundles are not this sandbox.

Loader: `apps/bridge/src/plugins/loader.ts` (`importBridgeRegister` for in-process;
`loadCommunityPluginInChild` for Community).
Policy: `apps/bridge/src/services/plugin-capabilities.ts`.
Isolation split: `apps/bridge/src/plugins/plugin-runtime-isolation.ts`.
Supervisor: `apps/bridge/src/plugins/plugin-child-host.ts`.

## Threat model (grants vs process isolation)

| Attacker goal | Grants stop? | Child-process sandbox would add |
|---------------|--------------|---------------------------------|
| Call undeclared `externalFetch` host | Yes (allowlist) | Defense in depth |
| Register undeclared tools / ObjectTypes | Yes | Defense in depth |
| Raw in-process `fetch` / Node `fs` / `child_process` | No | Yes (plugin JS is out of process) |
| Import `getPluginHost()` and bypass grant-wrapped `externalFetch` | No | Yes (host APIs only over IPC) |
| Mount hostile Express routes on the Bridge app | No | Yes if HTTP is proxied, not shared `app` |
| Malicious plugin `web.js` in the buyer browser | No (separate browser origin / auth gate) | No. Browser bundles stay a web threat, not a Bridge process threat |
| Escape coding jail during agent builds | N/A (different job type: #112 / #172) | N/A |

Intake and pins do not guarantee benign runtime after install. Kill switches (#96)
remain the emergency stop. Uninstall still revokes grants.

## Recommended v1 isolation

**Child process** with a **message-only** host API for untrusted **Community**
installs on Cloud.

- Not a worker thread that shares the Bridge heap.
- Not Firecracker / VM-grade isolation for plugins until coding VM work (#172) proves ops cost.
- **Official** stays in-process until the Community runner is proven (Official is ReBotics-curated plus grants).
- Local / operator paths stay unrestricted and in-process (trusted folders / `GODMODE_PLUGIN_PATH`).

Community is the priority because sellers are untrusted. Official connectors still
must meet [OFFICIAL_CONNECTORS.md](OFFICIAL_CONNECTORS.md).

## How grants compose with the sandbox

1. Install still writes `godmode.capabilities.json` from catalog + manifest.
2. The child may only call host APIs the Bridge exposes over IPC (`GodModePluginApi` / `PluginHostServices`). No shared `getPluginHost()`.
3. `host.externalFetch`, `api.tools.register`, and kernel / ObjectType access stay grant-gated **inside** that IPC boundary.
4. Last-tenant uninstall still deletes grants. Kill switches still apply.
5. Residual `fetch` / `fs` in Community plugin JS is out of the Bridge process. Grants still wrap the IPC host APIs.

Do not change the grant file format for v1.

## Cost and ops

| Item | v1 expectation |
|------|----------------|
| Processes | One extra Node process per active Community plugin (a pool can come later) |
| Crash | Child exit must not take down Bridge. Surface Attention for that plugin |
| Hot-reload | Recycle the child. Do not cache-bust `import()` in the Bridge process for sandboxed plugins |
| Cloud | Community-on-Cloud first. Self-host can keep in-process until the same runner is wired |
| Boot | Spawn on activate / `load_runtime`. Kill on unregister / last-tenant uninstall |

## Non-goals

- Sandboxing Official plugins in v1
- Docker, bubblewrap, or Firecracker for plugin `register()`
- Treating coding Layers 1–4 as plugin isolation
- Private plugin `file:` dependencies in core
- Changing `godmode.capabilities.json` shape

## Follow-up

Official remains in-process until this Community runner is proven in production.
Coding VM work stays on [#172](https://github.com/ReBoticsAI/GodMode/issues/172).
