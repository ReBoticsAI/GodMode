# Multi-Tenant Data Model

This document defines how the GodMode platform partitions data, routes requests, and handles collaboration and marketplace features.

## Two-tier storage

### Core database (`core.sqlite`)

Global platform state shared across all workspaces:

| Table group | Purpose |
|-------------|---------|
| `users`, `sessions` | Email/password identity and auth |
| `tenants`, `tenant_memberships` | Workspaces and roles |
| `credit_wallets`, `credit_ledger` | Platform economy |
| `marketplace_listings`, `marketplace_purchases`, `marketplace_entitlements` | Marketplace |
| `share_grants` | Cross-tenant resource sharing |
| `shared_chat_sessions` | Collaborative chat registry |
| `inference_endpoints`, `inference_usage` | Metered inference products |
| `bridge_connections` | Local/remote Bridge federation registry |
| `platform_meta` | Bootstrap flags |

Legacy `oauth_accounts` rows may exist from older installs; OSS core no longer writes to this table.

### Per-tenant database (`tenants/<uuid>.sqlite`)

One SQLite file per workspace. Physical file selection provides isolation; most tables have no `tenant_id` column.

| Table group | Purpose |
|-------------|---------|
| `departments`, `divisions`, `division_pages` | Navigation structure |
| `ai_agents`, `ai_chats`, `ai_messages`, `ai_memories`, … | AI workspace |
| `holdings_*` | Financial connections |
| Wiki, kanban, calendar, vault tables | Productivity |

Domain-specific tables (trading, external integrations) are added by **plugins** when installed.

## Tenant context contract

Every HTTP request, WebSocket connection, and background job must carry:

```typescript
{ userId: string; tenantId: string; role: MembershipRole }
```

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

Connections are registered in `bridge_connections` (core DB) and resolved at runtime.

## Signup and admin bootstrap

1. User signs up with **email and password** (`POST /auth/signup`).
2. Bridge creates a user row, session, and default workspace tenant.
3. `seedPersonalOsForNewTenant` provisions Life department placeholders and welcome wiki.
4. If `INITIAL_ADMINS` is empty, `promoteFirstSignupAdmin` makes the first signup platform admin.

Pre-seeded admins (`INITIAL_ADMINS=Name:email`) receive optional `INITIAL_ADMIN_PASSWORD` on first boot.

## Marketplace and sharing

- **Listings** live in core DB; **entitlements** gate access to portable resources.
- **Share grants** allow read/editor access to agents, pages, or workflows across tenants.
- **Credits** debit on purchase; hub mode uses Stripe for top-ups.

See [architecture.md](architecture.md) for the full system diagram.
