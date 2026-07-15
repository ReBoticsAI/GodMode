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

The deployed registry exposes 54 core ObjectTypes, including `StructureNode`.
This is a hybrid architecture: the kernel standardizes discovery and dispatch,
while domain adapters preserve authoritative business logic.

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

The dispatcher validates action input and output, authorizes the caller, enforces
confirmation and declared concurrency checks, applies idempotency protection,
redacts sensitive values from audit data, and emits declared events. Metadata is
not a promise by itself: only behavior implemented by the current dispatcher and
adapter is enforced.

Asynchronous actions return an `OperationRun`. Runs persist status, result or
error, and timestamps for audit and inspection. On restart, interrupted runs are
marked failed rather than resumed.

Current limitations: retry policy, timeout, `errorSchema`, deprecation, custom
concurrency version fields, `bulk` behavior, and strict enforcement of
`cancellable` are declared metadata but are not generically executed by the
dispatcher. Idempotency expiry/retry and native optimistic version handling are
also limited. Adapters must not promise those behaviors until host enforcement
is added.

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
installed. Definition replacement is ownership checked and atomic; core
lifecycle state, tenant seeds, hooks, and knowledge import are separate durable
steps with compensation, not one cross-database transaction. Native plugin
tables and records are intentionally retained on uninstall so reinstall and
recovery do not destroy tenant data.

Secret fields and declared sensitive action paths are redacted from logs and
audit payloads. Plugin custom Express routes are outside generic Record dispatch;
their authors must enforce authentication, tenant boundaries, and installed
plugin visibility explicitly.

Declared action events are stored durably. The relay records consumer receipts
so a named consumer can skip a previously completed durable event; this provides
idempotent processing, not exactly-once delivery. Generic `object.record.*`
notifications use the in-memory event bus.

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
discovery, plugin runtime registrations, and generic web list/form pages.
`StructureNode.object_type` chooses generic Record rendering; `segment` remains
the URL segment.

## Compatibility and protocol exceptions

The migration inventory classifies legacy HTTP mutations by their target.
Structure compatibility routes currently delegate to kernel operations so
existing clients keep working; most other entries are migration targets and have
not yet been replaced by kernel dispatch. Legacy mutation telemetry records
remaining use. A shim can be retired only after delegation/parity is verified
and usage remains at zero for a sustained observation period.

Some transports cannot be represented as a normal Record response. Live chat
token streaming remains an explicit protocol exception: the session and model
lifecycle are kernel-discoverable, but the streaming connection keeps its
specialized protocol. Uploads and similar transport concerns may also remain
exceptions while durable domain state uses Records and actions.

## Plugin author checklist

1. Prefer manifest-native ObjectTypes for straightforward tenant data.
2. Register an executable adapter for service-backed behavior.
3. Declare only operations and actions the adapter implements.
4. Supply strict schemas, roles, confirmation, idempotency, concurrency, and
   sensitive-input metadata.
5. Use generated discovery and action tools instead of adding static mutation
   tools when possible.
6. Treat `tenantMigrations` as manifest metadata unless a specific host runner is
   documented; it is not a general migration framework.
7. Back up persistent data before schema or deployment changes and test install,
   uninstall, reinstall, and tenant isolation.
