# Roadmap

Intentions for GodMode after the current [Unreleased](CHANGELOG.md) work. Themes only — not a schedule or commitment list. Shipped behavior lives in the [changelog](CHANGELOG.md) and [feature catalog](docs/FEATURES.md).

## Near-term polish

| Theme | Why |
|-------|-----|
| **Provider / remote harness deltas** | OpenAI, Anthropic, and remote profiles are still stubs vs the fleshed Gemma 4 and Cursor families |
| **Bank ledger UI** | Account/balance schema and tools exist; the Bank page ledger experience is still thin |
| **Hub credits purchase** | Marketplace wallets need real purchase rails beyond stub / dev grants |
| **Plugin HTTP routes without restart** | Tools install live today; Express routes may still need a Bridge restart |
| **Support staffing UX** | Core Support group staffing shipped; continue polishing Admin / staff inbox flows |

## Memory and Intelligence

| Theme | Why |
|-------|-----|
| **Optional ANN / vector store** | Current memory uses hybrid RAG + EmbeddingGemma attach; a dedicated ANN backend remains deferred ([AGENT_MEMORY.md](docs/AGENT_MEMORY.md)) |
| **Richer multi-agent handoffs** | Better stall recovery and cross-agent delegation beyond today's org chart tools |
| **Cursor parity (later epic)** | IDE chat-history import, Cursor rules/MCP as authority, and Cursor apply-diff UX — **not** required for `cursor_cloud` Intelligence today ([CURSOR_SUBSCRIPTION.md](docs/CURSOR_SUBSCRIPTION.md)) |

## Opt-in integrations (not core defaults)

| Theme | Why |
|-------|-----|
| **Live bank / exchange OAuth** | Deeper payment and funding rails so agents can execute funded actions, not only track balances |
| **Calendar / email sync connectors** | Bring external schedule and mail into the personal OS when the user installs them |
| **External knowledge connectors** | OpenWiki CLI, Gmail, Notion — explicitly out of v1 agent memory scope |

## Platform

| Theme | Why |
|-------|-----|
| **Marketplace maturity** | Submission tooling and verified publisher badges for catalog authors |
| **Training / persona adapters** | Unsloth-oriented training helpers exist; productized one-click adapters and safer eval loops do not |
| **Hub scale storage** | Optional external Postgres (or similar) for `core` at larger multi-tenant scale ([DEPLOY.md](DEPLOY.md)) |
| **Digital You depth** | Stronger persona proposals and “ask the user via Digital You” defaults across agents |

## How to follow along

- Merged changes: [CHANGELOG.md](CHANGELOG.md) and GitHub releases / PRs
- Docs index: [docs/README.md](docs/README.md)
- Issues and discussion: [GitHub Issues](https://github.com/ReBoticsAI/GodMode/issues)
