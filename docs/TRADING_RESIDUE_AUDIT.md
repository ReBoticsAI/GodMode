# Trading Residue Audit

Sierra Chart and Polymarket remain plugin-owned. They must not be registered as
core ObjectTypes. Core retains only generic plugin, connector, event, storage,
and ObjectType contracts.

## Required plugin-host contract

- Plugin lifecycle, manifest ObjectTypes/records/migrations, page-kind
  registration, and web runtime:
  `packages/plugin-api/src/{manifest,bridge-api}.ts`,
  `apps/bridge/src/kernel/{plugin-object-types,kind-registry}.ts`, and
  `apps/web/src/plugins/runtime.tsx`.
- Generic time-series access:
  `packages/plugin-api/src/host-services.ts` and
  `apps/bridge/src/services/timeseries-store.ts`.
- Current Sierra-specific host callbacks:
  `packages/plugin-api/src/host-services.ts` and
  `apps/bridge/src/plugins/plugin-host-bridge.ts`.

The Sierra-specific callbacks are required until both private plugins move to
generic capability registration for health providers, connector commands,
schedulers, and external-run wait states.

## Temporary migration compatibility

- Structure regroup and group-tab backfills:
  `apps/bridge/src/services/{structure-regroup-migration,group-tabs-migration}.ts`.
- `pm_signals` compatibility indexing:
  `apps/bridge/src/services/data-management-migration.ts`.
- SQLite cold-store backfill for `sc_timesales`, `sc_bars`, and
  `pm_price_history`: `apps/bridge/src/services/timeseries-store.ts`.
- Sierra schema upgrades and normalization: `apps/bridge/src/db.ts`.
- Legacy Builder redirect: `apps/web/src/App.tsx`.

Remove these only after idempotent plugin migrations copy and validate each
tenant's data, record completion by tenant/plugin version, and provide an
export or rollback path.

## Removable legacy residue

### Core storage

`apps/bridge/src/db.ts` still creates trading tables for all tenants:

- General trading: `playbooks`, `deployments`, `commands`, `journal_entries`,
  `positions`, `orders`, `trading_plan`, routine/daily-state tables.
- Sierra mirrors and telemetry: `sc_*`, `setup_phases`, `order_lifecycle`,
  `study_settings*`, and `playbook_zones`.
- Backtesting: `backtest_*` and `playbook_signal_state`.
- Trading-adjacent storage: `chartbook_layout`, `file_cursors`, `data_audit`,
  `account_config`, and `source_health`.

Stop creating these after plugin migrations own equivalent tenant storage.

### Page kinds, events, and shell UI

- Hard-coded kinds and tabs:
  `apps/bridge/src/services/{page-kinds,group-tab-definitions}.ts`,
  `apps/web/src/lib/{page-registry,group-tab-definitions}.tsx`.
- Enumerated trading WebSocket events: `apps/bridge/src/ws.ts`.
- Domain event UI: `apps/web/src/components/{LiveEvents,ReplayBanner}.tsx`.
- Trading-specific badges/examples:
  `apps/web/src/components/intelligence/projects/ActiveWorkPanel.tsx` and
  `apps/web/src/pages/intelligence-flow/WorkflowFlow.tsx`.

Plugins should declare page kinds, tab layouts, event metadata, and shell
components. Core WebSocket handling should forward namespaced plugin events.

### Routes, connectors, and configuration

- Sierra federation/dispatch:
  `apps/bridge/src/routes/{federation,connections}.ts` and
  `apps/bridge/src/services/federation-client.ts`.
- SC-only connector contract: `apps/connector/src/local-connector.ts`.
- Sierra IPC/chart/backtest settings and startup:
  `apps/bridge/src/{config,bootstrap}.ts`.
- Domain-aware storage reporting and time-series dataset names:
  `apps/bridge/src/services/{storage-usage,timeseries-store}.ts`.

Replace these with generic connector dispatch and plugin-declared storage
datasets before removal.

### AI and automation

Trading-specific policy remains in:

- `apps/bridge/src/services/{autonomous-executor,platform-scope,confirm-policy,chat-mode,ai-workflows,event-bus,card-awaiting}.ts`
- `apps/bridge/src/services/agents/agents-db.ts`
- `apps/bridge/src/services/engines/context.ts`
- `apps/web/src/hooks/use-agent-mention-sources.ts`

Plugins must contribute tool risk/confirmation metadata, event types,
external-run states, context sources, and skill activation.

### Web API, scripts, and documentation

- Domain DTOs/calls: `apps/web/src/api.ts`.
- Scripts: `scripts/{sc-screenshot,find-zone-signals}.ps1`.
- Residue allowlist: `scripts/audit-oss-core.mjs`.
- Lower-risk examples/comments:
  `.gitignore`, `docker-compose.yml`, `packages/flow-core/src/types.ts`,
  `docs/SALES_PITCH.md`, and `scripts/godmode-plugins-cli.ts`.

Plugin web clients must stop importing the core API compatibility surface
before those DTOs and calls are removed.

## Removal gate

Physical removal is a separate change and requires:

1. Both plugins install and operate independently through generic host
   contracts.
2. Per-tenant migration checks show copied row counts and checksums.
3. Plugin tools own risk policy, events, scheduler hooks, and connector
   dispatch.
4. No legacy endpoint, page-kind, table, or WebSocket use is observed during
   the compatibility window.
5. Backups and tested rollback/export paths exist.

