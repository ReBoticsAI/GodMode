# @godmode/kernel

GodMode **metadata kernel** vocabulary and helpers — shared by Bridge, web, plugins, and agents.

## Vocabulary (not DocTypes)

| Term | Meaning |
|------|---------|
| **ObjectType** | Metadata definition: fields, access policy, operations, actions, naming, and storage |
| **Field** | Typed property on an ObjectType, with validation and optional UI/secret metadata |
| **Record** | One ObjectType instance; portable rows guarantee `id`, `objectType`, and `data` |

Department / division / page remain **UX labels** for tree roles on `StructureNode` Records.

## Agent pipeline

```
authenticated consumer → ObjectType registry/policy → adapter or native storage → Record response/event
```

1. Declare an `ObjectTypeDef` (built-in or plugin `godmode.plugin.json` → `objectTypes`).
2. Bridge kernel registers it and materializes storage (`adapter` or `native` table).
3. Declare supported CRUD operations and named action contracts explicitly.
4. Agents use generated Record/action tools; web page kinds `record-list` and
   `record-form` render metadata-driven UI.

Built-in **StructureNode** is an adapter over `structure_nodes` — no duplicate
tree. `StructureNode.object_type` selects generic Record rendering, while
`segment` remains the URL segment.

## Storage

- **adapter** — wraps an existing service/table (`adapterId`)
- **native** — SQLite table `gm_ot_<snake_name>` (or custom `tableName`)

Native schema evolution is additive only. `schemaVersion` is descriptive and
does not run destructive migrations. `contractVersion` independently revisions
the public metadata/action contract.

## Actions and runtime context

Actions declare collection/record target, effect, schemas, roles, confirmation,
idempotency, concurrency, execution mode, cancellation, redaction, and events.
The Bridge dispatcher validates and enforces action input/output/error schemas,
roles, confirmation, idempotency/expiry, custom concurrency version fields,
redaction, and durable event append before invoking the adapter. Asynchronous
work is represented by durable `OperationRun` Records and generically enforces
leases, declared retries/backoff, timeout, cancellation eligibility, and
replay-safe recovery. Declared bulk execution remains unsupported until an
adapter provides its dedicated shape; deprecation metadata is descriptive.

The strict repository audit currently discovers 74 ObjectTypes, 346 generated
tool candidates, and 75 static tools, with zero legacy routes/callers, unmatched
mutation callers, direct audited entry-point writes, or tool collisions. Core
contract tests require exact CRUD/action declaration-handler parity.

Every operation requires an `OperationContext`; consumers must not bypass tenant,
role, confirmation, or installed-plugin checks. Plugin custom routes sit outside
generic dispatch and enforce those boundaries themselves.

Bridge and web plugins receive a versioned typed kernel client
(`apiVersion: 1`). Executable manifests may require `kernelApiVersion: 1`;
unsupported future versions are rejected rather than guessed.

The complete host behavior, routes, compatibility policy, and current
limitations are documented in
[`docs/OBJECTTYPE_KERNEL.md`](../../docs/OBJECTTYPE_KERNEL.md).
