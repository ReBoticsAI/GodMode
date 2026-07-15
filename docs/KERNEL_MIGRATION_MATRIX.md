# Kernel migration matrix

This document is the human-readable companion to
`scripts/audit-kernel-coverage.mjs`. The script is the authoritative,
machine-readable baseline: it statically scans every TypeScript file in
`apps/bridge/src/routes` and `apps/bridge/src/kernel/routes.ts` for Express
`post`, `put`, `patch`, and `delete` declarations.

The baseline currently covers 195 mutation-verb declarations:

- **Kernel Record API:** 3 dynamic create/update/delete routes.
- **Kernel action API:** 2 dynamic declared-action routes (collection and
  record target).
- **Compatibility shims:** 165 legacy or domain-specific routes with an
  ObjectType/action migration target.
- **Protocol exceptions:** 25 routes whose boundary is not Record CRUD.

The audit rejects both additions and removals. A route cannot disappear,
change verb/path, or be added until its baseline entry is deliberately updated
with one of the four classifications and a target or rationale. It also rejects
mutation declarations whose path is not a static string, so dynamic routing
cannot bypass review.

## Domain coverage

- **Platform structure (17 declarations):** legacy departments, divisions,
  pages, and nodes target `StructureNode` Records and declared structure
  actions. The generic kernel routes are the replacement boundary.
- **Intelligence and automation (75 declarations):** memories, rules, skills,
  artifacts, agents, workflows, schedules, queues, datasets, chats, projects,
  and calendar operations target their registered ObjectTypes or explicit
  actions.
- **Identity and administration (17 declarations):** user/tenant membership
  mutations target `User`, `Tenant`, and `TenantMembership`; authentication and
  billing control-plane operations and onboarding remain protocol exceptions.
- **Collaboration and knowledge (40 declarations):** shares, direct messages,
  notifications, support, wiki, hooks/events, and personal productivity target
  the corresponding registered read models and service-backed ObjectTypes.
- **Marketplace, finance, and connectivity (41 declarations):** catalog,
  listing, entitlement, holding, bridge, and peer routes have explicit domain
  targets; remote execution and network orchestration remain protocol
  exceptions.
- **Kernel-native boundary (5 declarations):** dynamic Record create, update,
  delete, and both declared action execution targets are classified directly as
  `kernel-record` or `kernel-action`.

These counts describe route declarations, not unique public URLs. For example,
`routes/hooks.ts` contains two routers that each declare `POST /`; the baseline
tracks declaration occurrence so neither is silently collapsed.

## Protocol exceptions

Protocol exceptions are intentionally narrow and include a rationale in the
machine baseline:

- authentication/session/credential flows and first-run onboarding;
- platform-admin billing configuration and provider checks;
- federation, Tailscale, peer invitations, and signed remote dispatch;
- inference execution and endpoint provisioning;
- external calendar/email synchronization;
- plugin install/uninstall lifecycle operations;
- the read-only analytical SQL endpoint, which uses POST to carry a structured
  query body.

An exception does not imply weaker authorization. It means the operation is a
control-plane, compute, transport, or executable-lifecycle command rather than
durable ObjectType Record CRUD.

## AI tool inventory

The same audit inventories the static `AI_TOOL_REGISTRY` without importing or
executing Bridge runtime code.

- All 104 explicit static tools must appear in one of 10 named non-kernel
  domain groups. A newly added static tool fails the audit until grouped.
- The 7 generic kernel tools are separately marked:
  `list_object_types`, `list_records`, `get_record`, `create_record`,
  `update_record`, `delete_record`, and `run_record_action`.
- The audit requires both kernel registration paths:
  `genericObjectTypeToolDefs()` and `objectTypeAutoToolDefs(coreNames)`.
  Per-ObjectType tools remain generated from registered ObjectTypes rather than
  being copied into a stale hand-maintained list.
- Plugin tools are runtime registrations and are outside the static registry
  baseline; their registration path remains tenant/plugin scoped.

## Updating the inventory

When a mutation route changes, update the embedded route baseline in
`scripts/audit-kernel-coverage.mjs` in the same change. Use:

- `kernel-record` for generic Record create/update/delete;
- `kernel-action` for an action declared by an ObjectType adapter;
- `compatibility-shim` for a legacy/domain route with a concrete migration
  target;
- `protocol-exception` only with a concise explanation of why Record/action
  semantics do not fit.

Do not place credentials, request bodies, tokens, endpoint secrets, or customer
data in this inventory.
