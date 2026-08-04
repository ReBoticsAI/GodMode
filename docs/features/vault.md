---
slug: vault
title: "Personal Vault"
section: "Productivity"
location: "/vault"
summary: "Personal connect hub for integrations, wallets and accounts, marketplace, and secrets. GodMode Cloud and inference keys live in Platform Vault. Storage lives in Settings → Storage."
---
# Personal Vault

![vault in GodMode](/features/vault.png)

**Personal Vault** is the user connect hub for personal credentials and account connects. Chat → an agent's **Agent Vault** tab opens that agent's private vault. Platform credentials (GodMode Cloud, LLM keys, Exa) live under **Platform Vault** in the sidebar. Database usage and workspace export live under **Settings → Storage**.

## Three vaults

| Vault | Surface | Contents |
|-------|---------|----------|
| **Platform** | Sidebar **Platform Vault** (`/settings/vault`) | GodMode Cloud seats, LLM subscriptions, API keys, Exa / search, platform secrets |
| **Personal** | Sidebar **Personal Vault** (`/vault`) | GitHub, Wallets & Accounts (personal), Marketplace, user secrets |
| **Agent** | Agent sidebar / panel **Agent Vault** tab, or `/vault?agent=<id>` | Secrets and Wallets & Accounts for that agent (no Inference) |

There is no owner Select picker. Each surface is scoped to one vault.

### Resolve order (LLM / Exa)

When an agent runs:

1. That **Agent** Vault secrets (if a matching secret exists)
2. **Platform** Vault

Personal Vault credentials are never used as LLM or Exa fallback. Env vars (for example `OPENAI_API_KEY`) still win when set. Chat model picker behavior is unchanged. Inference Connect cards (Subscriptions, API Keys, Search) are Platform-only under Platform Vault.

## Personal Vault tabs (`/vault`)

### Integrations

#### GitHub

The **Connect GitHub** card installs and authorizes the GitHub App used for Projects sync (and Cloud sign-in when configured).

### Wallets & Accounts

Moralis and PayPal **API credentials** for live sync, plus wallet and account connect flows (crypto wallets, exchanges, bank, PayPal, manual). Bank keeps the ledger view only.

Deep link: `/vault?tab=wallets`.

### Marketplace

Seller **Stripe Connect** for Community payouts. Marketplace → Sell links here for connect; ToS Accept and listing tools stay on Sell.

### All Secrets

Free-form secrets in the Personal Vault (`owner_kind=user`). Prefer named Connect cards when one exists.

## Platform Vault

Sidebar label **Platform Vault**. Deep link: `/settings/vault?vault=cloud|inference|secrets` (Inference subs: `&sub=subscriptions|api-keys|search`).

Legacy `/settings/platform?tab=vault&…` redirects here. Legacy `/vault?tab=cloud`, `/vault?tab=billing`, and `/vault?tab=inference` also redirect here. Agent Vault `?tab=inference` (or `?tab=search`) redirects here too.

### GodMode Cloud

GodMode Cloud seat billing (Stripe Customer Portal). Shown only on SaaS hosts.

Provider LLM subscriptions (for example Cursor) stay under Inference → Subscriptions. They are not GodMode Cloud seats.

### Subscriptions

Use your plan (billed by the provider):

| Provider | Secret id | Harness profile | Docs |
|----------|-----------|-----------------|------|
| Cursor | `cursor-api-key` | `cursor-*` family | Cursor subscription |
| Z.AI GLM Coding Plan | `zai-coding-api-key` | `zai-coding` | [Coding Plan](https://docs.z.ai/devpack/quick-start) |
| OpenCode Go | `opencode-go-api-key` | `opencode-go` | [OpenCode Go](https://opencode.ai/docs/go/) |
| DigitalOcean Inference | `digitalocean-inference-api-key` | `digitalocean-inference` | [Serverless Inference](https://docs.digitalocean.com/reference/api/reference/serverless-inference/) |
| Snowflake Cortex | `snowflake-cortex-api-key` (+ `snowflake-cortex-base-url`) | `snowflake-cortex` | [Cortex REST API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api) |
| OpenCode Zen | `opencode-zen-api-key` | `opencode-zen` | [OpenCode Zen](https://opencode.ai/docs/zen/) |
| MiniMax Token Plan | `minimax-token-api-key` | `minimax-token` | [Token Plan](https://platform.minimax.io/docs/token-plan/other-tools) |
| Kimi Code | `kimi-code-api-key` | `kimi-code` | [Kimi Code](https://www.kimi.com/code/docs/en/) |
| Poe | `poe-api-key` | `poe` | [Poe API](https://creator.poe.com/docs/external-applications/openai-compatible-api) |

Z.AI Coding Plan uses the coding-only base URL (`https://api.z.ai/api/coding/paas/v4`), not general payg (`/api/paas/v4`). OpenCode Zen uses `https://opencode.ai/zen/v1` (detect Go `…/zen/go` before Zen). DigitalOcean Inference uses `https://inference.do-ai.run/v1` with a model access key (not account OAuth). Snowflake Cortex uses a PAT plus account URL normalized to `https://<account>.snowflakecomputing.com/api/v2/cortex/v1`. MiniMax Token Plan shares `https://api.minimax.io/v1` with payg but uses a distinct subscription secret id (`minimax-token-api-key`). Kimi Code uses `https://api.kimi.com/coding/v1` (not Moonshot payg). Poe uses `https://api.poe.com/v1` and spends the key owner's subscription points. Per-tenant keys only. Do not pool consumer subscription tokens on Cloud.

OAuth / device-code / product-auth providers (Copilot, Codex, GitLab Duo, SuperGrok, Amazon Q) remain deferred. See [Vault OAuth subscription providers](./vault-oauth-subscriptions.md) (#355).

### API Keys

Metered BYOK with named Connect cards:

| Provider | Secret id | Harness profile | Docs |
|----------|-----------|-----------------|------|
| OpenAI Platform | `openai-api-key` | `openai` | [Function calling](https://platform.openai.com/docs/guides/function-calling) |
| Anthropic Console | `anthropic-api-key` | `anthropic` | [Tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview) |
| OpenRouter | `openrouter-api-key` | `openrouter-*` family (from model slug) | [OpenRouter](https://openrouter.ai/docs) |
| Groq | `groq-api-key` | `groq-*` family (from model id) | [Groq](https://console.groq.com/docs/openai) |
| Together | `together-api-key` | `together-*` family (from model id) | [Together](https://docs.together.ai/docs/inference/openai-compatibility) |
| Fireworks | `fireworks-api-key` | `fireworks-*` family (from model id) | [Fireworks](https://docs.fireworks.ai/tools-sdks/openai-compatibility) |
| DeepSeek | `deepseek-api-key` | `deepseek-flash` / `deepseek-pro` / `deepseek-generic` | [DeepSeek](https://api-docs.deepseek.com/) |
| Google AI Studio | `google-ai-api-key` | `google-ai-flash` / `google-ai-pro` / `google-ai-generic` | [Gemini OpenAI compat](https://ai.google.dev/gemini-api/docs/openai) |
| xAI Console | `xai-api-key` | `xai-grok` / `xai-generic` | [xAI docs](https://docs.x.ai/docs) |
| Z.AI Platform (payg) | `zai-api-key` | `zai-payg` | [Z.AI OpenAI compat](https://docs.z.ai/guides/develop/openai/python) |
| MiniMax (payg) | `minimax-api-key` | `minimax-payg` | [MiniMax OpenAI compat](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| Custom OpenAI-compatible | `custom-openai-api-key` (+ `custom-openai-base-url`) | `custom-openai` | Any OpenAI-compatible `/v1` root |

### Search

**Exa** Connect stores Platform secret `exa_api_key`. No Intelligence harness Apply; Exa is for `web_search` and `fetch_url` only.

1. Sign up at [dashboard.exa.ai](https://dashboard.exa.ai) and create an API key.
2. Connect the key on Platform Vault → Inference → Search → Exa.
3. If Exa blocks for exhausted credits, add credits or wait for the monthly free refresh at [Exa billing](https://dashboard.exa.ai/billing).

GodMode Cloud routes agent `web_search` and `fetch_url` through [Exa](https://exa.ai) so egress uses Exa's network instead of the shared VPS IP. Cloud requires **tenant BYOK** (no platform shared key).

Self-host / local: Exa is optional. When `exa_api_key` is present on Agent secrets or Platform, web tools use Exa; otherwise they keep the DuckDuckGo / direct-fetch fallback.

See [[cursor-cloud]].

## Agent Vault

Open from the agent group in the sidebar (**Agent Vault** child row) or the Intelligence panel **Agent Vault** tab. Optional deep link: `/vault?agent=<agentId>`.

Tabs:

- **Secrets**: free-form agent secrets (`owner_kind=agent`)
- **Wallets & Accounts**: wallet and account connects for that agent (`?tab=wallets`)

No Inference UI. Platform Inference lives under Platform Vault. No Select; no Personal Vault tabs (GitHub, Marketplace, etc.).

## Schema note

`ai_secrets.owner_kind` is `platform` | `user` | `agent`. `agent_id` is set only for agent rows. Name uniqueness is per `(owner_kind, agent_id)`.

## Route

- Personal: `/vault` (tabs: `?tab=integrations|wallets|marketplace|secrets`; default `integrations`)
- Agent: `/vault?agent=<id>` (tabs: `secrets|wallets`; default `secrets`)
- Platform: `/settings/vault?vault=cloud|inference|secrets` (Inference: `&sub=…`)
- Storage: `/settings/platform?tab=storage` (usage + workspace data; see [[settings]])
- Legacy `/settings/platform?tab=vault&…` redirects to Platform Vault
- Legacy `?tab=search` / `?tab=inference` / `?tab=cloud` / `?tab=billing` on `/vault` redirect to Platform Vault
- Legacy `?tab=storage` on `/vault` redirects to Settings → Storage
- Legacy Bank `?tab=wallets|accounts` redirects to `/vault?tab=wallets`
