# Changelog

All notable changes to GodMode are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Post–0.1.0 work on `main` (merged PRs #1–#15). No new version tag yet — see [CONTRIBUTING.md](CONTRIBUTING.md#what-we-are-looking-for-roadmap-themes) for planned themes.

### Added

- **Durable ObjectType kernel** — 74 ObjectTypes discovered by strict audit;
  explicit CRUD and named actions; exact declaration/adapter parity; mandatory
  operation context, access policy, confirmation, idempotency, concurrency,
  redaction, structured errors, durable events/consumer receipts, and
  asynchronous retries, timeouts, cancellation, leases, and replay-safe recovery
- **Completed consumer cutover** — generic Record/action HTTP routes, 346
  generated AI-tool candidates, capability discovery, metadata-driven web
  list/form UI, 75 static tools, and strict zero legacy routes/callers, unmatched
  mutation callers, direct entry-point writes, or generated-tool collisions;
  five narrow mutation protocol exceptions remain
- **Tenant-safe workflows** — shared-resource adapters enforce exact grants and
  owner-database routing; marketplace clone acquisition and plugin lifecycle use
  durable idempotent cross-database sagas rather than implied cross-SQLite
  transactions
- **Versioned plugin kernel client** — Bridge/web plugin API version 1 with
  manifest negotiation and unsupported-version rejection
- **Per-workspace FirstRunWizard** — onboarding (Welcome → LLM → Ready) is tenant-scoped; hub installs never share platform-wide completion flags
- **`LLAMA_EXTERNAL` attach mode** — Bridge attaches to a host-managed `llama-server` (no spawn/kill inside Docker); hub external LLM compose example
- **Unified Intelligence model catalog** — picker lists local GGUFs, Cursor subscription models, cloud providers, and shared/remote endpoints
- **Model harness profiles** — picker-driven profiles per family (`gemma-4` live; Cursor Auto / Composer / Grok; OpenAI / Anthropic / remote stubs) for tool mode, sampling, and discovery middleware
- **Cursor subscription Intelligence** (`cursor_cloud`) — Vault User API key; Auto (Cursor picks) or named models; GodMode tools via `@cursor/sdk`
- **Four-layer agent memory** — working history, semantic memories + hybrid RAG, episodic distill, procedural skills gate; wiki hybrid RAG and synthesize proposals; hub EmbeddingGemma attach (`EMBEDDINGS_*` / `EMBEDDINGS_EXTERNAL`)
- **Intelligence plugin pipeline** — `scaffold_plugin` → `build_plugin` → `install_plugin` on local and hub (tools load without Bridge restart)
- **Support group staffing** — Admin configures users and agents who answer hub/shared support tickets
- **Unified signed release flow** — scheduled Mountain-Time nightlies plus
  verified `vX.Y.Z` tags publish stable releases; one canonical
  manifest binds GHCR digests, Windows/Linux bundles, desktop installers
  (Electron), checksums, SBOMs, and provenance to the same revision
- **Electron desktop app** (`apps/desktop`) — local-only windowed shell that
  embeds Bridge + web, ships NSIS/DMG/AppImage/deb installers, and applies
  signed updates through Admin → Updates
- **Installation update kernel** — core-backed release/update Records,
  administrator actions, ETag-aware polling, deduplicated notifications,
  coordinated snapshots, readiness/preflight diagnostics, plugin lock
  compatibility, and surface-specific Docker/bare-metal update paths

### Fixed

- Gemma tool loops on external LLM (native tools + identical-call breaker)
- Hub Intelligence local-LLM default and support ticket routing
- Docker hub plugin loads (`@godmode` package links) and production plugin UI (host singleton import map)
- ~5s black screen after production sign-in
- Embedding-only GGUFs (e.g. EmbeddingGemma) excluded from the Intelligence chat model picker
- Vault Cursor Connect status (named `cursor_api_key` counts as connected; model-list errors no longer clear Connected)
- Structure Record listing now returns child plugin nodes when no parent filter is
  requested; Structure action compatibility calls send the kernel's flat input
  body

### Documentation

- [LOCAL_LLM.md](docs/LOCAL_LLM.md) — Gemma 4 reference profile, harness table, external attach
- [CURSOR_SUBSCRIPTION.md](docs/CURSOR_SUBSCRIPTION.md) — Auto vs named Cursor models
- [AGENT_MEMORY.md](docs/AGENT_MEMORY.md) — memory layers and embeddings
- Marketplace Docker hub notes; onboarding / verification updates
- [OBJECTTYPE_KERNEL.md](docs/OBJECTTYPE_KERNEL.md) — canonical architecture,
  enforced action contract, tenancy, durable recovery, and protocol exceptions
- [KERNEL_MIGRATION_MATRIX.md](docs/KERNEL_MIGRATION_MATRIX.md) — governed route
  and AI-tool migration inventory
- [RELEASES.md](docs/RELEASES.md) — channels, artifact trust, update controls,
  snapshots, rollback, offline verification, and plugin compatibility
- Coordinated ecosystem migrations were completed in:
  [godmode-plugin-git#1](https://github.com/ReBoticsAI/godmode-plugin-git/pull/1),
  [godmode-plugin-github#1](https://github.com/ReBoticsAI/godmode-plugin-github/pull/1),
  [GodMode-Marketplace#2](https://github.com/ReBoticsAI/GodMode-Marketplace/pull/2),
  and private domain-plugin PRs delivered in their respective repositories

## [0.1.0] - 2026-06-29

First public release of GodMode — a local-first personal OS.

### Added

- **Intelligence** — built-in platform agent with chat, tools, rules, skills, and automations
- **Digital You** — persona agent for personal tone and context
- **Agents** — org chart and Pipeline configuration for models, tools, and profiles
- **Structure** — departments, divisions, and custom pages
- **Wiki**, **Tasks**, **Calendar**, and **Vault**
- **Marketplace** — install optional domain plugins
- **Shared & federation** — connect workspaces across GodMode instances
- **Docker deployment** — client and production compose stacks
- Documentation — [Getting started](docs/GETTING_STARTED.md), [Configuration](docs/CONFIGURATION.md), and [Features](docs/FEATURES.md)

[Unreleased]: https://github.com/ReBoticsAI/GodMode/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ReBoticsAI/GodMode/releases/tag/v0.1.0
