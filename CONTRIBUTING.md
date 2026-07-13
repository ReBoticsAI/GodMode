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

Run `npm run audit:oss` before release-related PRs.

## Pull requests

- Keep changes focused; match existing code style.
- Run `npm run typecheck` before submitting.
- Do not commit secrets (`.env`, API keys, wallet keys).
- Domain-specific integrations belong in **external plugin repos**, not the public core tree.

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

### Platform

| Theme | Why |
|-------|-----|
| **Marketplace maturity** | Submission tooling and verified publisher badges for catalog authors |
| **Training / persona adapters** | Unsloth-oriented training helpers exist; productized one-click adapters and safer eval loops do not |
| **Hub scale storage** | Optional external Postgres (or similar) for `core` at larger multi-tenant scale ([DEPLOY.md](DEPLOY.md)) |
| **Digital You depth** | Stronger persona proposals and “ask the user via Digital You” defaults across agents |

Open an issue or draft PR if you are unsure whether work belongs in core vs a plugin. Discussion: [GitHub Issues](https://github.com/ReBoticsAI/GodMode/issues).

## Security

Report security issues via [GitHub private security advisories](https://github.com/ReBoticsAI/GodMode/security/advisories/new) — do not open public issues for production vulnerabilities. See [SECURITY.md](SECURITY.md).

## Plugins

Platform core changes belong in this repo (`@godmode/plugin-api`, `@godmode/plugin-host`, loader, install UX). Domain-specific integrations ship as plugins — see [docs/PLUGIN_AUTHORING.md](docs/PLUGIN_AUTHORING.md).
