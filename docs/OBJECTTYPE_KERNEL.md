# ObjectType Kernel

The ObjectType kernel is GodMode's contract layer between authenticated consumers
and the services or storage that own platform data. It gives the web app, agents,
plugins, and HTTP clients one discoverable vocabulary without replacing domain
business logic.

## Vocabulary and contracts

- An **ObjectType** declares a stable type name, module, fields, access policy,
  supported CRUD operations, named actions, and its storage adapter.
- A **Field** describes one record value, including its type, validation,
  required or secret status, relationships, and UI hints.
- A **Record** is an ObjectType instance. The portable `RecordRow` contract
  guarantees `id`, `objectType`, and typed `data`; adapters may expose timestamps
  or a resource version as additional fields.
- `contractVersion` revises the public metadata/action contract.
  `schemaVersion` describes the storage schema supplied by an owner; it does not
  perform compatibility checks or run migrations.
- The package and plugin API versions identify the executable contract. Consumers
  must not infer behavior from metadata that the active kernel version does not
  enforce.

ObjectTypes must explicitly declare at least one CRUD operation or named action.
The registry validates definitions before exposing them.

## Registration and storage

Core definitions are grouped by domain under `apps/bridge/src/kernel/domains`.
At startup, the Bridge registers those definitions and binds each one to an
adapter.

There are two storage models:

1. **Adapter-backed ObjectTypes** delegate to existing authoritative services or
   tables. This is the normal migration path for core domains because validation,
   authorization, side effects, and integrations remain in their established
   services.
2. **Native ObjectTypes** materialize SQLite tables from manifest field
   definitions. Native schema evolution is additive only. Removing, renaming, or
   changing the type of a field requires an explicit migration outside the
   generic materializer.

The strict static audit discovers 72 deployed ObjectTypes, including
`StructureNode`. All authenticated durable-domain mutations cross this kernel
boundary. Service-backed adapters preserve authoritative business logic; that
implementation choice does not create a second mutation path.

## Operations and actions

CRUD capabilities are opt-in through `operations`: `list`, `get`, `create`,
`update`, and `delete`. A request is rejected when the ObjectType does not
declare the requested operation.

Actions represent domain behavior that does not fit CRUD. An action declares:

- collection, record, or declared bulk target;
- read, write, destructive, or external effect;
- synchronous or asynchronous execution;
- input and output JSON Schemas;
- allowed roles and whether explicit confirmation is required;
- idempotency and optimistic-concurrency behavior;
- retry, cancellation, sensitive-input, audit, and event metadata where
  applicable.

The dispatcher validates action input, output, and structured errors; authorizes
the caller; enforces confirmation and declared concurrency/version fields;
applies scoped idempotency with expiry and replayed success/failure state;
redacts sensitive audit input; and appends declared durable events.

Asynchronous actions return a durable `OperationRun`. A tenant-aware worker
claims runs with leases and heartbeats, persists attempts and results, enforces
declared timeouts with `AbortSignal`, retries only retryable errors/codes up to
`maxAttempts` with declared backoff, and exposes cancellation only when
`cancellable` is declared. Cancellation aborts an in-process handler and
atomically finalizes both the run and its idempotency record. On startup or
lease expiry, interrupted work is requeued only when retry/idempotency metadata
makes replay safe; unsafe work fails closed with `KERNEL_REPLAY_UNSAFE`.

Declared bulk actions are rejected until an adapter implements their dedicated
execution shape. Deprecation metadata remains descriptive. An adapter that
performs external I/O must honor the supplied abort signal for prompt physical
cancellation; the host still prevents a cancelled run from being finalized as
successful.

## Security and tenancy

Every kernel request carries an `OperationContext`, including tenant, user,
roles, source, request and idempotency keys, expected version, confirmation
state, installed plugin IDs, and system capability where applicable.

Authorization is layered:

1. authenticated route or trusted system entry point;
2. tenant visibility and ObjectType access policy;
3. operation or action role and confirmation policy;
4. adapter/service authorization and data scoping.

Plugin ObjectTypes are visible only to tenants where their owning plugin is
installed. Definition replacement is ownership checked and atomic. Plugin
activation records separate durable lifecycle steps with compensation.
Marketplace clone acquisition uses an idempotent cross-database saga: core and
tenant steps are recorded independently and resume safely after interruption
instead of pretending SQLite files share one transaction. Native plugin tables
and records are intentionally retained on uninstall so reinstall and recovery
do not destroy tenant data.

Shared-resource adapters resolve the exact active grant and owner database for
each resource. Viewers receive read parity, editors mutate the owner's record,
and missing, revoked, expired, wrong-kind, guessed-ID, or clone access fails
closed. A caller's role in its own tenant never upgrades a share grant.

Secret fields and declared sensitive action paths are redacted from logs and
audit payloads. Plugin custom Express routes are outside generic Record dispatch;
their authors must enforce authentication, tenant boundaries, and installed
plugin visibility explicitly.

Declared action events are stored durably. The relay leases each event and
records a receipt per named consumer only after that consumer succeeds. A retry
skips completed consumers and resumes the unfinished set; this is durable
at-least-once delivery with per-consumer idempotent receipts, not exactly-once
delivery. Generic `object.record.*` notifications use the in-memory event bus.

## Consumers

The generic API exposes discovery plus:

- CRUD at `/api/records/:objectType` and
  `/api/records/:objectType/:id`;
- collection actions at
  `/api/records/:objectType/actions/:action`;
- record actions at
  `/api/records/:objectType/:id/actions/:action`.

Action input is the request body itself, not `{ "input": ... }`.
Action clients provide `Idempotency-Key`, `If-Match`, and
`X-Kernel-Confirmation` headers when required by the declared contract.

ObjectType metadata also powers generated AI CRUD/action tools, capability
discovery, plugin runtime registrations, and generic web list/form pages. Bridge
and web plugins receive a typed kernel client with `apiVersion: 1`; executable
plugins may declare `kernelApiVersion`, and unsupported future versions are
rejected during manifest validation.
`StructureNode.object_type` chooses generic Record rendering; `segment` remains
the URL segment.

## Completed migration and protocol exceptions

At the completion baseline, the strict audits discover 72 core ObjectTypes and
report 0 legacy routes, 0 legacy callers, 0 unmatched mutation callers, and 0
direct writes in audited entry points. Tenant registries can expose additional
ObjectTypes from installed executable or declarative plugins. Five domain
routes remain as verified kernel delegates, not compatibility shims. Exact
declaration/handler parity is tested for every core adapter.

Some wire protocols cannot be represented as JSON Record responses. Live chat
uses WebSocket/token streaming; DM upload/download transfers multipart or binary
bytes; authentication establishes or invalidates cookies; typing presence is
ephemeral; analytics POST carries a read-only query; and signed external charting
dispatch is a command transport. These are explicit, narrow transport
exceptions. Their durable domain effects use kernel CRUD/actions where
applicable; binary and stream transport are not themselves Record CRUD.

## Plugin author checklist

1. Prefer manifest-native ObjectTypes for straightforward tenant data.
2. Register an executable adapter for service-backed behavior.
3. Declare only operations and actions the adapter implements.
4. Supply strict schemas, roles, confirmation, idempotency, concurrency, and
   sensitive-input metadata.
5. Use generated discovery and action tools instead of adding static mutation
   tools when possible.
6. Declare `kernelApiVersion: 1` for executable clients and use `api.kernel`
   rather than legacy mutation URLs.
7. Treat `tenantMigrations` as manifest metadata unless a specific host runner is
   documented; it is not a general migration framework.
8. Back up persistent data before schema or deployment changes and test install,
   uninstall, reinstall, and tenant isolation.
