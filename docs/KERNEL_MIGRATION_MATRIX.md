# Kernel migration matrix

This is the human-readable companion to `scripts/audit-kernel-coverage.mjs` and
`scripts/audit-kernel-direct-writes.mjs`. The scripts discover the current
TypeScript route, caller, ObjectType, AI-tool, and durable-write surface; there
is no hand-maintained route baseline.

At the completion baseline, `npm run audit:kernel:strict` reports:

- **15 mutation routes:** 3 kernel Record routes, 2 kernel action routes,
  5 domain routes that delegate to the kernel, and 5 protocol exceptions;
- **0 legacy routes, 0 legacy callers, and 0 unmatched mutation callers** in
  web, scripts, connectors, or checked-in plugins;
- **0 direct SQL or filesystem writes** in audited entry points;
- **74 ObjectTypes** discovered from production declarations;
- **75 static AI tools**, **346 generated tool candidates**, and
  **0 static/generated collisions**.

The strict audit is the completion gate. A new authenticated durable mutation
must dispatch through declared ObjectType CRUD/action behavior; a new static
tool, caller, direct write, or specialized transport must remain discoverable
and pass strict classification and parity checks.

## Enforced domain boundary

All durable domain mutations now enter through the kernel. The five
domain-specific mutation routes that remain are thin transport delegates with
static, validated ObjectType/action targets; they are not compatibility shims.
Authoritative services remain behind adapters, and exact adapter parity tests
require every declared CRUD operation and action to have a handler and reject
every undeclared one.

The direct-write audit covers Bridge routes, plugin entry points, scripts,
Connector entry points, bootstrap, and AI tool execution. Versioned migrations
and adapter implementations are the intentional write owners.

## Specialized protocol exceptions

The mutation-route audit permits exactly five narrow exceptions:

- `POST /api/auth/login` — credential verification and session-cookie creation;
- `POST /api/auth/logout` — session-cookie invalidation;
- `POST /api/analytics/timeseries/query` — read-only analytical query with a
  structured POST body;
- `POST /api/federation/sc/:` — authenticated external charting command
  transport with no local durable mutation;
- `POST /api/dm/conversations/:/typing` — ephemeral presence with no durable
  mutation.

The full protocol registry also documents health, WebSocket negotiation, and
authorized DM binary upload/download. Multipart bytes, byte streams, WebSocket
frames, signed external command transport, ephemeral presence, and read-only
query transport are not Record CRUD. Their durable domain effects are
kernel-delegated where applicable; the transport itself remains specialized.

## AI tool inventory

The audit parses `AI_TOOL_REGISTRY` without importing Bridge runtime code.
Seven generic tools provide ObjectType discovery, CRUD, and action execution:
`list_object_types`, `list_records`, `get_record`, `create_record`,
`update_record`, `delete_record`, and `run_record_action`. Per-ObjectType tools
are generated from the 74 discovered definitions, producing 346 current
candidates. The remaining 75 static tools cover non-generated platform,
transport, and operational capabilities. Runtime plugin tools remain
tenant/plugin scoped and outside the static count.

## Changing the boundary

Run `npm run audit:kernel:strict` for any route, caller, tool, ObjectType,
adapter, migration, plugin, Connector, or durable-write change. Add a protocol
exception only when the wire protocol itself cannot be expressed as JSON Record
CRUD/action semantics, include a narrow rationale, and keep durable effects
behind kernel dispatch. Never put credentials, request bodies, tokens, endpoint
secrets, or customer data in audit metadata.
