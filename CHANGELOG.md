# Changelog

All notable changes to GodMode are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Post–0.1.0 work on `main` (merged PRs #1–#15). No new version tag yet — see [ROADMAP.md](ROADMAP.md) for planned themes.

### Added

- **Per-workspace FirstRunWizard** — onboarding (Welcome → LLM → Ready) is tenant-scoped; hub installs never share platform-wide completion flags
- **`LLAMA_EXTERNAL` attach mode** — Bridge attaches to a host-managed `llama-server` (no spawn/kill inside Docker); hub external LLM compose example
- **Unified Intelligence model catalog** — picker lists local GGUFs, Cursor subscription models, cloud providers, and shared/remote endpoints
- **Model harness profiles** — picker-driven profiles per family (`gemma-4` live; Cursor Auto / Composer / Grok; OpenAI / Anthropic / remote stubs) for tool mode, sampling, and discovery middleware
- **Cursor subscription Intelligence** (`cursor_cloud`) — Vault User API key; Auto (Cursor picks) or named models; GodMode tools via `@cursor/sdk`
- **Four-layer agent memory** — working history, semantic memories + hybrid RAG, episodic distill, procedural skills gate; wiki hybrid RAG and synthesize proposals; hub EmbeddingGemma attach (`EMBEDDINGS_*` / `EMBEDDINGS_EXTERNAL`)
- **Intelligence plugin pipeline** — `scaffold_plugin` → `build_plugin` → `install_plugin` on local and hub (tools load without Bridge restart)
- **Support group staffing** — Admin configures users and agents who answer hub/shared support tickets

### Fixed

- Gemma tool loops on external LLM (native tools + identical-call breaker)
- Hub Intelligence local-LLM default and support ticket routing
- Docker hub plugin loads (`@godmode` package links) and production plugin UI (host singleton import map)
- ~5s black screen after production sign-in
- Embedding-only GGUFs (e.g. EmbeddingGemma) excluded from the Intelligence chat model picker
- Vault Cursor Connect status (named `cursor_api_key` counts as connected; model-list errors no longer clear Connected)

### Documentation

- [LOCAL_LLM.md](docs/LOCAL_LLM.md) — Gemma 4 reference profile, harness table, external attach
- [CURSOR_SUBSCRIPTION.md](docs/CURSOR_SUBSCRIPTION.md) — Auto vs named Cursor models
- [AGENT_MEMORY.md](docs/AGENT_MEMORY.md) — memory layers and embeddings
- Marketplace Docker hub notes; onboarding / verification updates

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
