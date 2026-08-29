# Multi-Tenant Data Model

This document defines how the GodMode platform partitions data, routes requests, and handles collaboration and marketplace features.

## Storage planes (Cloud + Users + User + Workspace)

| Plane | Path | Scope |
|-------|------|--------|
| **Cloud** (host) | `Cloud.sqlite` via `getCloudDb()` (boot-migrates from legacy `core.sqlite`; archives still include both names; kernel `database: "cloud"`) | Identity, workspace registry, billing, marketplace registry, shares, releases |
| **Users** (host hub) | `Users.sqlite` | Cross-account hub: DMs, Support, Notifications, platform groups |
| **User** (per account) | `users/<userId>.sqlite` | **Platform Vault** Connect keys and future personal-layer continuity |
| **Workspace** | `tenants/<workspaceId>.sqlite` | Per project sandbox: Structure, agents/chats, plugins, wiki (SoR), hooks / `hook_runs` (SoR), `platform_events` (SoR; Workspace id required), optional workspace key override |

Mental model: host Cloud + host Users, then each account gets a **User** DB plus one or more **Workspace** DBs. Consumer Connect secrets live on the per-account User DB (Platform Vault chrome), not on Cloud or host Users.

## Host Cloud (`Cloud.sqlite`)

Installation-wide identity and commerce (not hub chat surfaces):

| Table group | Purpose |
|-------------|---------|
| `users`, `sessions` | Email/password identity and auth |
| `tenants`, `tenant_memberships` | Workspaces and roles |
| `tenant_plugins` | Durable per-workspace plugin lifecycle state |
| `credit_wallets`, `credit_ledger` | Platform economy |
| `marketplace_listings`, `marketplace_purchases`, `marketplace_entitlements` | Marketplace |
| `share_grants` | Cross-tenant resource sharing |
| `shared_chat_sessions` | Collaborative chat registry |
| `inference_endpoints`, `inference_usage` | Metered inference products |
| `bridge_connections` | Local/remote Bridge federation registry |
| `platform_meta` | Bootstrap flags (includes hub migrate marker) |
| `legacy_endpoint_usage` | Historical upgrade telemetry; strict audit has no legacy callers |
| `marketplace_acquisition_operations`, steps/audit/outbox | Durable cross-DB acquisition saga |
| `releases`, `installation_update_state`, history/attempts/snapshots/receipts | Signed release discovery, deduplicated notification, update and rollback evidence |
| `events` (legacy PlatformEvent) | May hold orphan rows with null `tenant_id` until cleaned; live SoR is Workspace `platform_events` |
| `ai_queue_index` | Cross-tenant AI job **discovery** pointers (`tenant_id`, `job_id`, status, priority, `run_after`, workflow id). Job payload and results stay in workspace `ai_prompt_queue` |

### Host Users (`Users.sqlite`)

Cross-account hub surfaces (soft `user_id` refs into Cloud `users`; no cross-file FKs):

| Table group | Purpose |
|-------------|---------|
| `dm_*` | Direct messages, members, blobs, attachments |
| `support_*` | Support tickets and messages |
| `notifications` | User and agent notifications |
| `platform_groups`, `platform_group_members` | Support staff groups and similar |

Legacy `oauth_accounts` rows may exist from older installs; OSS core no longer writes to this table.

### User database (`users/<userId>.sqlite`)

One SQLite file per signed-up account (created on signup / first workspace).

| Table group | Purpose |
|-------------|---------|
| `ai_secrets` (`owner_kind=platform`) | **Platform Vault** Connect secrets (Cursor, LLM keys, Exa, etc.), shared across that account’s workspaces |
| `ai_secrets` (`owner_kind=user`, GitHub Connect) | **Personal Vault** GitHub Connect (`github-projects-oauth`), shared across that account’s workspaces |

Other Personal Vault free-form secrets and Agent Vault remain workspace-scoped today.

### Workspace database (`tenants/<uuid>.sqlite`)

One SQLite file per workspace. Physical file selection provides isolation; most tables have no `tenant_id` column.

| Table group | Purpose |
|-------------|---------|
| `structure_nodes` | Navigation structure and generic Record page metadata |
| `ai_agents`, `ai_chats`, `ai_messages`, `ai_memories`, … | AI workspace |
| `holdings_*` | Financial connections |
| Wiki, kanban, calendar, Personal/Agent vault tables | Productivity (wiki SoR lives on Workspace; Platform Vault Connect keys and Personal Vault GitHub Connect live on the User DB) |
| `hooks`, `hook_runs` | Automations hooks SoR (migrated from Cloud by `owner_tenant_id`) |
| `platform_events` | PlatformEvent trigger log SoR (`tenant_id` required; not the outbox `events` table) |
| `ai_secrets` workspace override | Optional project-specific Connect keys (`owner_kind=platform`) |
| `gm_ot_*` | Native plugin ObjectType Records |
| `kernel_action_idempotency`, `kernel_operation_runs`, action logs | Kernel action execution and audit state |
| `events`, `event_consumer_receipts` | Durable declared-action events and consumer receipts |
| `marketplace_acquisition_imports`, acquisition audit/outbox | Tenant half of clone acquisition saga |

Domain-specific tables (trading, external integrations) are added by **plugins** when installed.

### Platform Vault resolve order

For LLM / Exa Connect secrets: process env (when checked) → Agent Vault (workspace) → workspace platform override → **Platform Vault** (account User DB). Personal Vault never feeds LLM/Exa. Different accounts never share Platform Vault rows.

## Tenant export (Cloud to local)

Workspace owners can download a consistent snapshot of **their** tenant SQLite file
from Cloud Settings (**Download my database**), via `GET /api/tenant/database/download`.

- Authz: session + membership; **owner** role only. Tenant id comes from membership
  resolution (`X-Tenant-Id` / session), never from a client-supplied filesystem path.
- Snapshot: better-sqlite3 `backup()` API (not a raw copy of a live WAL-open file).
- Scope: one `tenants/<tenantId>.sqlite` only. No `Cloud.sqlite`, no `users/*.sqlite`,
  no other tenants, no DuckDB analytics. Platform-admin DR of full stamps is a
  separate path (#243 / Admin Observability).
- Rate-limited; success/failure audited in Cloud `platform_action_log`
  (`tenant.database.download`). Response is `Cache-Control: no-store`.
- Local import: place the file under `PLATFORM_DATA_DIR/tenants/` (or the desktop
  data dir equivalent) with a matching GodMode version, or migrate after open.
  Older desktop builds may refuse or require schema migrations. Treat the file as
  sensitive (vault, holdings, chat).

## Tenant context contract

Every HTTP request, WebSocket connection, and background job must carry:

```typescript
{ userId: string; tenantId: string; role: MembershipRole }
```

Kernel dispatch expands that identity into `OperationContext`, adding source,
installed plugin IDs, request and idempotency keys, expected version,
confirmation state, and trusted system capability where applicable.

### HTTP

- Client sends `X-Tenant-Id` (or `?tenantId=`).
- `resolveTenant` in `apps/bridge/src/services/auth/middleware.ts` validates membership and sets `req.tenantDb`.
- Handlers use `getReqTenantDb(req)` or `tdb(req)` — never a boot-captured operator DB for tenant-scoped tables.

### WebSocket

- Browsers cannot set headers; pass `?tenantId=` on connect.
- Server validates tenant membership before joining `tenant:<id>` rooms.
- `join_resource` requires share grant or ownership.

### Background jobs

- Queue rows include `tenant_id`; workers open `getTenantDb(tenantId)` per job.
- SaaS discovery uses Cloud `ai_queue_index` (see [Workspace DB open policy](#workspace-db-open-policy-saas)). Empty tenants are not opened by the AI queue poll loop.

### Workspace DB open policy (SaaS)

24/7 agents do **not** mean opening every workspace SQLite 24/7. Bridge opens a workspace DB when that tenant has due background work, or when an interactive session holds a pin (chat WebSocket lifetime or an Intelligence turn). Idle and empty tenants stay closed on the AI queue hot path.

| Plane | Role for jobs / sessions |
|-------|--------------------------|
| `Cloud.sqlite` | Installation-wide registry **and** the cross-tenant pending/running job index |
| `Users.sqlite` | Hub surfaces only (DMs, Support, Notifications, platform groups). Not the job index |
| `tenants/<workspaceId>.sqlite` | Workspace SoR, including full `ai_prompt_queue` payload and results |

**Queue path.** Enqueue dual-writes the workspace queue row and a Cloud `ai_queue_index` row, then wakes the worker (`ai_queue_wake`). Discovery reads the Cloud index first, then opens `getTenantDb(tenantId)` only for that job’s tenant. A low-frequency safety poll remains index-only (not a walk of every tenant file).

**Interactive Intelligence.** Live chat turns (HTTP and chat WebSocket) do not require the queue path for the live turn. Work and engine tenants are refcount-pinned for the turn (and for the WebSocket while connected). Tool context resolves the DB via live `getTenantDb(tenantId)` so the tenant LRU (`MAX_OPEN`) cannot leave mid-turn tools on a closed handle.

**Scheduler and reflection.** Do not probe every historical signup on a hot timer. Register due work from the Cloud index and/or an explicit enabled-tenant set. Open a workspace only when there is due work or an active session pin. AI queue discovery already follows this rule; other timers follow the same open policy.

### ObjectType routing

An ObjectType declares whether it uses the Cloud (`database: "cloud"`) or
Workspace database. Workspace ObjectTypes operate on the database selected after
membership validation; Cloud ObjectTypes still receive caller and tenant context
for policy checks. The registry only exposes plugin-owned ObjectTypes to tenants
where the plugin is installed.

Generic Record dispatch enforces ObjectType access policies and action roles,
then delegates to authoritative adapters/services for resource-level rules.
Custom plugin routes do not inherit this dispatch boundary and must perform the
same tenant and installation checks themselves.

Asynchronous actions are owned by the database declared for the ObjectType.
Tenant-aware workers claim leased `OperationRun` rows, enforce retry/backoff,
timeouts, cancellation, and idempotency, and recover interrupted runs only when
replay is safe. Durable event relays also operate per database and persist a
receipt after each named consumer succeeds.

Native ObjectType tables are additive and remain in the tenant database after
plugin uninstall. Uninstall removes runtime visibility and plugin-owned
knowledge, not tenant data. Backups and explicit retention/erasure procedures
must account for these retained tables.

Native ObjectTypes are always Workspace-local. Cloud-database ObjectTypes require
a reviewed service-backed adapter.

### Cross-database workflows

SQLite cannot atomically commit `Cloud.sqlite` and a Workspace file. Marketplace
clone acquisition therefore records an idempotent saga: operation registration
in Cloud, import in the buyer Workspace, purchase recording in Cloud, then
completion. Each database retains step, audit, and outbox evidence; retrying the
same idempotency key resumes the recorded operation and does not duplicate the
import or purchase. Plugin lifecycle uses the same durable-step principle
instead of claiming a cross-file transaction.

### Shared-resource database selection

Share grants are authorization records, not hints. Productivity adapters resolve
the exact active grant and owner tenant before selecting a database. Viewers
receive read parity only; editors mutate the owner's record. Missing, revoked,
expired, wrong-resource, wrong-kind, clone, and guessed-ID access fails closed,
regardless of the caller's role in its own tenant.

## Engine vs work (shared agents)

When a user operates someone else's shared agent:

| Layer | Database | Contents |
|-------|----------|----------|
| **Engine** | Owner tenant DB | Agent config, prompts, tools, RAG reads |
| **Work** | Actor tenant DB (or shared-session home) | Chats, messages, artifacts, memory writes |

Owned agents: `engineDb === workDb`.

Optional `contributeMemory` mirrors new memories into the owner's engine DB.

## Bridge connections (federation)

A **connection** resolves to another GodMode Bridge instance — used when a plugin or workflow needs remote compute.

| Mode | Meaning |
|------|---------|
| `local` | This Bridge on the same machine |
| `remote` | Another Bridge's federation API (peer URL + token) |

Connections are registered in `bridge_connections` (Cloud DB) and resolved at runtime.

## Signup and admin bootstrap

1. User signs up with **email and password** (`POST /auth/signup`).
2. Bridge creates a user row, session, and default workspace tenant.
3. `seedPersonalOsForNewTenant` provisions core tenant data; the structure tree
   intentionally starts empty until the user or Intelligence creates it.
4. If `INITIAL_ADMINS` is empty, `promoteFirstSignupAdmin` makes the first signup platform admin.

Pre-seeded admins (`INITIAL_ADMINS=Name:email`) receive optional `INITIAL_ADMIN_PASSWORD` on first boot.

## Marketplace and sharing

- **Listings** live in Cloud DB; **entitlements** gate access to portable resources.
- **Share grants** allow read/editor access to agents, pages, or workflows across tenants.
- **Credits** debit on purchase; hub mode uses Stripe for top-ups.

See [architecture.md](architecture.md) for the full system diagram.
