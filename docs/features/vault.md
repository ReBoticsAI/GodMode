---
slug: vault
title: "Vault"
section: "Productivity"
location: "/vault"
summary: "User connect hub for integrations, wallets and accounts, marketplace, and secrets. GodMode Cloud and inference keys live in Settings → Vault. Storage lives in Settings → Storage."
---
# Vault

![vault in GodMode](/features/vault.png)

Vault is the **User** connect hub for personal credentials and account connects. Chat → an agent's **Vault** tab opens that agent's private vault. Platform credentials (GodMode Cloud, LLM keys, Exa) live under **Settings → Vault**. Database usage and workspace export live under **Settings → Storage**.

## Three vaults

| Vault | Surface | Contents |
|-------|---------|----------|
| **Platform** | Settings → Vault | GodMode Cloud seats, LLM subscriptions, API keys, Exa / search, platform secrets |
| **User** | `/vault` | GitHub, Wallets & Accounts (personal), Marketplace, user secrets |
| **Agent** | Agent sidebar / panel Vault tab, or `/vault?agent=<id>` | Secrets and Wallets & Accounts for that agent (no Inference) |

There is no owner Select picker. Each surface is scoped to one vault.

### Resolve order (LLM / Exa)

When an agent runs:

1. That **Agent** Vault secrets (if a matching secret exists)
2. **Platform** Vault

User Vault credentials are never used as LLM or Exa fallback. Env vars (for example `OPENAI_API_KEY`) still win when set. Chat model picker behavior is unchanged. Inference Connect cards (Subscriptions, API Keys, Search) are Platform-only under Settings → Vault.

## User Vault tabs (`/vault`)

### Integrations

#### GitHub

The **Connect GitHub** card installs and authorizes the GitHub App used for Projects sync (and Cloud sign-in when configured).

### Wallets & Accounts

Moralis and PayPal **API credentials** for live sync, plus wallet and account connect flows (crypto wallets, exchanges, bank, PayPal, manual). Bank keeps the ledger view only.

Deep link: `/vault?tab=wallets`.

### Marketplace

Seller **Stripe Connect** for Community payouts. Marketplace → Sell links here for connect; ToS Accept and listing tools stay on Sell.

### All Secrets

Free-form secrets in the User Vault (`owner_kind=user`). Prefer named Connect cards when one exists.

## Platform Vault (Settings → Vault)

Deep link: `/settings/platform?tab=vault&vault=cloud|inference|secrets` (Inference subs: `&sub=subscriptions|api-keys|search`).

Legacy `/vault?tab=cloud`, `/vault?tab=billing`, and `/vault?tab=inference` redirect here. Agent Vault `?tab=inference` (or `?tab=search`) also redirects here.

### GodMode Cloud

GodMode Cloud seat billing (Stripe Customer Portal). Shown only on SaaS hosts.

Provider LLM subscriptions (for example Cursor) stay under Inference → Subscriptions. They are not GodMode Cloud seats.

### Subscriptions

Use your plan (billed by the provider):

| Provider | Secret id | Harness profile | Docs |
|----------|-----------|-----------------|------|
| Cursor | `cursor-api-key` | `cursor-*` family | Cursor subscription |
| Z.AI GLM Coding Plan | `zai-coding-api-key` | `zai-coding` | [Coding Plan](https://docs.z.ai/devpack/quick-start) |

Z.AI Coding Plan uses the coding-only base URL (`https://api.z.ai/api/coding/paas/v4`), not general payg (`/api/paas/v4`). Per-tenant keys only. Do not pool consumer subscription tokens on Cloud.

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

### Search

**Exa** Connect stores Platform secret `exa_api_key`. No Intelligence harness Apply; Exa is for `web_search` and `fetch_url` only.

1. Sign up at [dashboard.exa.ai](https://dashboard.exa.ai) and create an API key.
2. Connect the key on Settings → Vault → Inference → Search → Exa.
3. If Exa blocks for exhausted credits, add credits or wait for the monthly free refresh at [Exa billing](https://dashboard.exa.ai/billing).

GodMode Cloud routes agent `web_search` and `fetch_url` through [Exa](https://exa.ai) so egress uses Exa's network instead of the shared VPS IP. Cloud requires **tenant BYOK** (no platform shared key).

Self-host / local: Exa is optional. When `exa_api_key` is present on Agent secrets or Platform, web tools use Exa; otherwise they keep the DuckDuckGo / direct-fetch fallback.

See [[cursor-cloud]].

## Agent Vault

Open from the agent group in the sidebar (Vault child row) or the Intelligence panel Vault tab. Optional deep link: `/vault?agent=<agentId>`.

Tabs:

- **Secrets**: free-form agent secrets (`owner_kind=agent`)
- **Wallets & Accounts**: wallet and account connects for that agent (`?tab=wallets`)

No Inference UI. Platform Inference lives under Settings → Vault. No Select; no User tabs (GitHub, Marketplace, etc.).

## Schema note

`ai_secrets.owner_kind` is `platform` | `user` | `agent`. `agent_id` is set only for agent rows. Name uniqueness is per `(owner_kind, agent_id)`.

## Route

- User: `/vault` (tabs: `?tab=integrations|wallets|marketplace|secrets`; default `integrations`)
- Agent: `/vault?agent=<id>` (tabs: `secrets|wallets`; default `secrets`)
- Platform: `/settings/platform?tab=vault&vault=cloud|inference|secrets` (Inference: `&sub=…`)
- Storage: `/settings/platform?tab=storage` (usage + workspace data; see [[settings]])
- Legacy `?tab=search` / `?tab=inference` / `?tab=cloud` / `?tab=billing` on `/vault` redirect to Settings → Vault
- Legacy `?tab=storage` on `/vault` redirects to Settings → Storage
- Legacy Bank `?tab=wallets|accounts` redirects to `/vault?tab=wallets`
