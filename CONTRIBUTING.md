# Contributing to GodMode

Thank you for contributing. GodMode core is released under the [Apache License 2.0](LICENSE).

## Getting started

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- Bridge: http://localhost:3847

Fresh clone = **personal OS only** (Intelligence, wiki, tasks, structure). Copy `apps/bridge/.env.example` → `.env` before `npm run dev`. Domain integrations ship as optional external plugin repos — see [docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md).

## Development mode

`DEPLOYMENT_MODE=local` (default) is for local development. **Authentication is required by default** (`AUTH_ALLOW_ANONYMOUS=false` in `.env.example`). Set `AUTH_ALLOW_ANONYMOUS=true` only for headless local tooling — never on a network-exposed host.

Run `npm run audit:oss` before release-related PRs. Changes to authenticated
mutations, AI tools, ObjectTypes, adapters, or actions must also update the
kernel coverage baseline and contract tests.

## Platform principles (deps)

Prefer **first-party** platform capabilities over SaaS APM/logging products.
Bridge JSON logs + `platform_request_log` in core SQLite are the ops path. Do
not add Sentry (or similar) to core. Unavoidable external edges are fine when
they are not the product: Stripe, email transport (Resend/SMTP), OAuth IdPs as
a convenience login layer, Cloudflare at the network edge, optional operator
offsite object storage for backups.

## Issues and PRs

- Open a **GitHub issue** for work that will outlive one session (features,
  hardening follow-ups, bugs). Small issues are useful when they are independently
  shippable; tiny typos can stay in a drive-by PR without an issue.
- Reference issue numbers in commits/PR bodies (`Fixes #N` / `Refs #N`).
- Bundle related issues into one PR when they share a theme and review surface
  (e.g. “observability UI + backup status”), but avoid kitchen-sink PRs.
- Security-sensitive production vulns: use private advisories, not public issues
  (see Security below).

## Pull requests

- Keep changes focused; match existing code style.
- Run `npm run test:gate` before submitting kernel or route changes.
  `npm run audit:kernel:strict` and `npm run test:objecttypes` are available as
  focused checks; build affected production workspaces.
- Do not commit secrets (`.env`, API keys, wallet keys).
- Domain-specific integrations belong in **external plugin repos**, not the public core tree.
- Declare ObjectType operations/actions explicitly and keep adapter
  implementations, schemas, roles, confirmation, idempotency, concurrency,
  retry/timeout/cancellation/recovery, redaction, and durable event behavior
  consistent with the metadata. Core tests require exact declaration/handler
  parity.
- Preserve the authenticated `OperationContext` and tenant/plugin visibility;
  custom plugin routes require explicit install checks.
- Document protocol exceptions rather than disguising transport or control-plane
  operations as Record CRUD. See
  [docs/OBJECTTYPE_KERNEL.md](docs/OBJECTTYPE_KERNEL.md).
- The current strict baseline is 74 ObjectTypes, 75 static tools, 346 generated
  candidates, 5 protocol exceptions, and zero legacy routes/callers, unmatched
  callers, direct writes, or tool collisions. Do not reintroduce migration debt.
- Protocol exceptions are wire-level only: authentication cookies, read-only
  analytical POST, signed external command transport, ephemeral presence,
  WebSocket/token streams, and authorized binary transfer. Durable effects must
  still kernel-dispatch; bytes and streams are not Record CRUD.
- When mutation routes, callers, tools, or exceptions change, update the audit
  fixtures/tests and keep `npm run audit:kernel:strict` green.
- The completed plugin ecosystem cutover was coordinated through
  [godmode-plugin-git#1](https://github.com/ReBoticsAI/godmode-plugin-git/pull/1),
  [godmode-plugin-github#1](https://github.com/ReBoticsAI/godmode-plugin-github/pull/1),
  and [GodMode-Marketplace#2](https://github.com/ReBoticsAI/GodMode-Marketplace/pull/2).
  Private domain-plugin migrations were delivered in their own repositories.
  Future ecosystem migrations must likewise merge all coordinated external PRs
  before claiming completion.

## What we are looking for

Roadmap themes live as **GitHub Issues** (enhancements and follow-ups). See
[Issues](https://github.com/ReBoticsAI/GodMode/issues) for the exact work we
want help on or plan to build next. Shipped behavior:
[CHANGELOG.md](CHANGELOG.md) and [docs/FEATURES.md](docs/FEATURES.md).

**Contribution shape (how we think about new work):**

- Prefer **first-party** personal-OS depth over bolting on SaaS APM or similar
  (see Platform principles above).
- Domain-specific bank/exchange, calendar/mail sync, and knowledge connectors
  belong in **plugins**, not hard core dependencies.
- **Desktop download** (Electron + local Bridge) and **Hub PWA** (homescreen
  client of the hosted hub) are complementary install paths — do not collapse
  them into one product. Desktop installers already ship; PWA and other themes
  are tracked in Issues.
- Open an issue or draft PR if you are unsure whether work belongs in core vs a
  plugin.

## Security

Report security issues via [GitHub private security advisories](https://github.com/ReBoticsAI/GodMode/security/advisories/new) — do not open public issues for production vulnerabilities. See [SECURITY.md](SECURITY.md).

## Plugins

Platform core changes belong in this repo (`@godmode/plugin-api`, `@godmode/plugin-host`, loader, install UX). Domain-specific integrations ship as plugins — see [docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md).
