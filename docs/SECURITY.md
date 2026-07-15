# Security

GodMode is a self-hosted personal OS with optional AI agents that can run tools, including terminal commands and file edits when enabled. Treat every deployment as **trusted-operator** infrastructure unless you harden it deliberately.

## Production checklist

Before exposing Bridge to a network:

1. Set `DEPLOYMENT_MODE=hub` or `client` (never leave `local` on a public host).
2. Set `AUTH_ALLOW_ANONYMOUS=false`.
3. Set a strong `AUTH_SESSION_SECRET` (even though sessions are opaque DB IDs today, operators expect this to be set).
4. Set `INITIAL_ADMINS` for multi-admin hubs, or rely on first-signup admin only on isolated self-hosted instances.
5. Set `AUTH_ALLOW_SIGNUP=false` or require `AUTH_INVITE_CODES` on public hubs.
6. Do not set `INITIAL_ADMIN_PASSWORD` in production unless you force password change on first login.
7. Install plugins only from sources you trust — plugin bridge code runs with host privileges.

## Authentication

OSS core uses **email/password + HttpOnly session cookies** only. There is no OAuth login surface — credentials never leave your Bridge unless you expose it to a network.

## Threat model highlights

| Surface | Risk | Mitigation |
|---------|------|------------|
| AI coding tools (`run_terminal`, `edit_file`) | RCE for editors/agents with `codeAccess` | Disable code access on agents; use confirm mode |
| Federation API token | Remote command injection if token leaks | Rotate tokens; restrict network access |
| First signup admin | Race on internet-exposed fresh installs | Use invite codes or pre-seed `INITIAL_ADMINS` |
| Plugin bundles (`/api/plugins/*/web.js`) | Proprietary JS exposure | Requires authenticated tenant + installed plugin |
| Generic Records/actions (`/api/records/*`) | Cross-tenant or overbroad mutation | OperationContext, access/action policy, adapter scoping |
| DuckDB analytics | SQL against attached timeseries | Platform admin only; SELECT-only subset |
| Markdown rendering | `javascript:` links in assistant/wiki output | URL scheme allowlist in web UI |

## ObjectType kernel boundary

Generic Record routes do not replace authentication or domain authorization.
Each call receives an `OperationContext` containing tenant, user, role, source,
installed plugin IDs, confirmation state, request/idempotency key, and expected
version where applicable.

The dispatcher applies tenant visibility and ObjectType access policy, declared
operation/action roles, confirmation, JSON Schema validation, idempotency, and
optimistic concurrency before invoking an adapter. Adapters and authoritative
services remain responsible for resource-level checks and domain invariants.
Secret fields and declared sensitive action paths are redacted from audit data.
Asynchronous actions retain auditable `OperationRun` state and generically
enforce declared retries/backoff, timeout, cancellation eligibility, error
schema, idempotency expiry, and replay-safe recovery. Leases and heartbeats
prevent concurrent workers from owning the same run; interrupted work is
requeued only with a retry/idempotency guarantee and otherwise fails closed.

Ordinary callers cannot forge `source: "system"`; trusted system dispatch
requires an internal capability. Declared durable events use relay leases and
per-consumer success receipts, providing at-least-once delivery without
pretending to provide exactly-once side effects.

Shared-resource authorization resolves the exact active grant, resource kind,
resource ID, role, expiry, and owner tenant database. Viewer grants cannot
mutate; editor mutations target the owner's record; missing, revoked, expired,
wrong-kind, clone, and guessed-ID access fails closed.

Plugin ObjectTypes are visible only when their owner is installed for the active
tenant. This protection does not automatically wrap a plugin's custom Express
routes; plugin authors must authenticate, resolve the tenant, and check
installation explicitly. Plugin Bridge code still runs with host privileges.

Native ObjectType uninstall retains physical tables and Records to avoid
destructive data loss. Operators must include core and tenant SQLite files in
backups and handle erasure requirements explicitly.

Multipart upload/download, WebSocket/token streams, cookie establishment,
ephemeral presence, read-only analytical POST, and signed external command
transport remain explicit protocol exceptions. They must retain their own
transport authorization, and any durable domain effect still dispatches through
the kernel; binary and stream transport are not Record CRUD.

## Reporting

Open a private security advisory on GitHub for vulnerabilities in the public core. Do not commit secrets, wallet keys, or operator `.env` files.
