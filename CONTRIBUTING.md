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
- The current strict baseline is 72 ObjectTypes, 75 static tools, 335 generated
  candidates, 5 protocol exceptions, and zero legacy routes/callers, unmatched
  callers, direct writes, or tool collisions. Do not reintroduce migration debt.
- Protocol exceptions are wire-level only: authentication cookies, read-only
  analytical POST, signed external command transport, ephemeral presence,
  WebSocket/token streams, and authorized binary transfer. Durable effects must
  still kernel-dispatch; bytes and streams are not Record CRUD.
- When mutation routes, callers, tools, or exceptions change, update the audit
  fixtures/tests and `docs/KERNEL_MIGRATION_MATRIX.md`.
- The completed plugin ecosystem cutover was coordinated through
  [godmode-plugin-git#1](https://github.com/ReBoticsAI/godmode-plugin-git/pull/1),
  [godmode-plugin-github#1](https://github.com/ReBoticsAI/godmode-plugin-github/pull/1),
  and [GodMode-Marketplace#2](https://github.com/ReBoticsAI/GodMode-Marketplace/pull/2).
  Private domain-plugin migrations were delivered in their own repositories.
  Future ecosystem migrations must likewise merge all coordinated external PRs
  before claiming completion.

## What we are looking for (roadmap themes)

Intentions after the current [Unreleased](CHANGELOG.md) work — not a schedule or commitment list. Shipped behavior: [CHANGELOG.md](CHANGELOG.md) and [docs/FEATURES.md](docs/FEATURES.md). Good PRs often map to one of these themes.

### Near-term polish

| Theme | Why |
|-------|-----|
| **Provider / remote harness deltas** | OpenAI, Anthropic, and remote profiles are still stubs vs the fleshed Gemma 4 and Cursor families |
| **Bank ledger UI** | Account/balance schema and tools exist; the Bank page ledger experience is still thin |
| **Hub credits purchase** | Marketplace wallets need real purchase rails beyond stub / dev grants |
| **Plugin HTTP routes without restart** | Tools install live today; Express routes may still need a Bridge restart |
| **Support staffing UX** | Core Support group staffing shipped; continue polishing Admin / staff inbox flows |

### Memory and Intelligence

| Theme | Why |
|-------|-----|
| **Optional ANN / vector store** | Current memory uses hybrid RAG + EmbeddingGemma attach; a dedicated ANN backend remains deferred ([docs/AGENT_MEMORY.md](docs/AGENT_MEMORY.md)) |
| **Richer multi-agent handoffs** | Better stall recovery and cross-agent delegation beyond today's org chart tools |
| **Cursor parity (later epic)** | IDE chat-history import, Cursor rules/MCP as authority, and Cursor apply-diff UX — **not** required for `cursor_cloud` Intelligence today ([docs/CURSOR_SUBSCRIPTION.md](docs/CURSOR_SUBSCRIPTION.md)) |

### Opt-in integrations (not core defaults)

| Theme | Why |
|-------|-----|
| **Live bank / exchange OAuth** | Deeper payment and funding rails so agents can execute funded actions, not only track balances |
| **Calendar / email sync connectors** | Bring external schedule and mail into the personal OS when the user installs them |
| **External knowledge connectors** | OpenWiki CLI, Gmail, Notion — explicitly out of v1 agent memory scope |

Prefer shipping these as **plugins** when they are domain-specific, not as hard deps in core.

### Distribution (desktop download + hub PWA)

Two complementary install paths — do not collapse them into one product:

| Offer | Audience | What it should feel like |
|-------|----------|--------------------------|
| **Desktop Download** | Personal / `local` (or client) users on Win / macOS / Linux | Installer or portable app that runs **Bridge + UI on the machine** (SQLite stays local). Not “open a URL in Electron only” without a local runtime. |
| **Hub PWA** | Mobile (and desktop) visitors of a public **`hub`** | Browser “Add to Home Screen” / install for the hosted site; talks to the **remote** Bridge. Lightweight offline shell OK; full offline Intelligence is out of scope. |

**Desktop shape (recommended):** a thin native shell (Tauri or Electron — pick in an ADR when work starts) that (1) boots or embeds Bridge, (2) loads the web UI, (3) ships signed installers per OS, and (4) optionally pairs with the existing **Connector** for hardware-bound plugins. Docker / `npm run dev` remain supported; Download is the friendly path for non-developers.

**Hub PWA shape (recommended):** `manifest.webmanifest` + service worker for the Vite/web app behind hub nginx; install prompt when `DEPLOYMENT_MODE=hub` (or when a public base URL is set). Auth stays session/cookie based; treat the PWA as a **homescreen client of the hub**, not a second personal OS with its own SQLite on the phone.

Contribution-friendly slices: shell spike + packaging CI → README Download links; then hub-only manifest/SW + install UX smoke on iOS/Android.

### Platform

| Theme | Why |
|-------|-----|
| **Desktop Download (Win / macOS / Linux)** | Packaged personal OS for users who will not run Docker/npm; local Bridge + UI as above |
| **Hub Progressive Web App** | Installable mobile/desktop client for the hosted hub without an App Store |
| **Marketplace maturity** | Submission tooling and verified publisher badges for catalog authors |
| **Training / persona adapters** | Unsloth-oriented training helpers exist; productized one-click adapters and safer eval loops do not |
| **Hub scale storage** | Optional external Postgres (or similar) for `core` at larger multi-tenant scale ([DEPLOY.md](DEPLOY.md)) |
| **Digital You depth** | Stronger persona proposals and “ask the user via Digital You” defaults across agents |

Open an issue or draft PR if you are unsure whether work belongs in core vs a plugin. Discussion: [GitHub Issues](https://github.com/ReBoticsAI/GodMode/issues).

## Security

Report security issues via [GitHub private security advisories](https://github.com/ReBoticsAI/GodMode/security/advisories/new) — do not open public issues for production vulnerabilities. See [SECURITY.md](SECURITY.md).

## Plugins

Platform core changes belong in this repo (`@godmode/plugin-api`, `@godmode/plugin-host`, loader, install UX). Domain-specific integrations ship as plugins — see [docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md).
