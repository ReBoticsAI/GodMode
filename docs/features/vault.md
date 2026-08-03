---
slug: vault
title: "Vault"
section: "Productivity"
location: "/vault"
summary: "User connect hub for GodMode Cloud, integrations, wallets, marketplace, secrets, and storage. Inference keys live in Settings → Platform Vault."
---
# Vault

![vault in GodMode](/features/vault.png)

Vault is the **User** connect hub for personal credentials and account connects. Chat → an agent's **Vault** tab opens that agent's private vault. Platform inference keys live under **Settings → Platform Vault**.

## Three vaults

| Vault | Surface | Contents |
|-------|---------|----------|
| **Platform** | Settings → Platform Vault | LLM subscriptions, API keys, Exa / search |
| **User** | `/vault` | GodMode Cloud seats, GitHub, Wallets, Marketplace, Storage, user secrets |
| **Agent** | Agent sidebar / panel Vault tab, or `/vault?agent=<id>` | Secrets and optional inference keys for that agent only |

There is no owner Select picker. Each surface is scoped to one vault.

### Resolve order (LLM / Exa)

When an agent runs:

1. That **Agent** Vault
2. **Platform** Vault

User Vault credentials are never used as LLM or Exa fallback. Env vars (for example `OPENAI_API_KEY`) still win when set. Chat model picker behavior is unchanged.

## User Vault tabs (`/vault`)

### GodMode Cloud

GodMode Cloud seat billing (Stripe Customer Portal). Shown only on SaaS hosts.

Provider LLM subscriptions (for example Cursor) stay under Settings → Platform Vault → Subscriptions. They are not GodMode Cloud seats.

### Integrations

#### GitHub

The **Connect GitHub** card installs and authorizes the GitHub App used for Projects sync (and Cloud sign-in when configured). Settings keeps a short dual-home link here.

### Wallets

Moralis and PayPal **API credentials** for live Bank / wallet sync. Wallet connect and PayPal balance link flows stay on Bank.

### Marketplace

Seller **Stripe Connect** for Community payouts. Marketplace → Sell links here for connect; ToS Accept and listing tools stay on Sell.

### All Secrets

Free-form secrets in the User Vault (`owner_kind=user`). Prefer named Connect cards when one exists.

### Storage

Database and data-store sizes. Monitor growth before trimming or upgrading stores.

## Platform Vault (Settings)

Deep link: `/settings/platform?vault=inference&sub=subscriptions|api-keys|search`.

Legacy `/vault?tab=inference` redirects here.

### Subscriptions

Use your plan (billed by the provider). **Cursor** Connect stores a fixed `cursor-api-key` on Platform (or on an Agent Vault when connected from the agent panel).

### API Keys

Metered BYOK with named Connect cards:

| Provider | Secret id | Harness profile | Docs |
|----------|-----------|-----------------|------|
| OpenAI Platform | `openai-api-key` | `openai` | [Function calling](https://platform.openai.com/docs/guides/function-calling) |
| Anthropic Console | `anthropic-api-key` | `anthropic` | [Tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview) |
| OpenRouter | `openrouter-api-key` | `openrouter-*` family (from model slug) | [OpenRouter](https://openrouter.ai/docs) |
| Groq | `groq-api-key` | `groq-*` family (from model id) | [Groq](https://console.groq.com/docs/openai) |
| Together | `together-api-key` | `together-*` family (from model id) | [Together](https://docs.together.ai/docs/inference/openai-compatibility) |

### Search

**Exa** Connect stores Platform (or Agent) secret `exa_api_key`. No Intelligence harness Apply; Exa is for `web_search` and `fetch_url` only.

1. Sign up at [dashboard.exa.ai](https://dashboard.exa.ai) and create an API key.
2. Connect the key on Settings → Platform Vault → Search → Exa (or the agent's Vault → Inference → Search).
3. If Exa blocks for exhausted credits, add credits or wait for the monthly free refresh at [Exa billing](https://dashboard.exa.ai/billing).

GodMode Cloud routes agent `web_search` and `fetch_url` through [Exa](https://exa.ai) so egress uses Exa's network instead of the shared VPS IP. Cloud requires **tenant BYOK** (no platform shared key).

Self-host / local: Exa is optional. When `exa_api_key` is present on Agent or Platform, web tools use Exa; otherwise they keep the DuckDuckGo / direct-fetch fallback.

See [[cursor-cloud]].

## Agent Vault

Open from the agent group in the sidebar (Vault child row) or the Intelligence panel Vault tab. Optional deep link: `/vault?agent=<agentId>`.

Shows that agent's secrets and Inference Connect cards only. No Select; no User tabs (Cloud, GitHub, etc.).

## Schema note

`ai_secrets.owner_kind` is `platform` | `user` | `agent`. `agent_id` is set only for agent rows. Name uniqueness is per `(owner_kind, agent_id)`.

## Route

- User: `/vault` (tabs: `?tab=cloud|integrations|wallets|marketplace|secrets|storage`; default `cloud`)
- Agent: `/vault?agent=<id>` (tabs: `secrets|inference`)
- Platform: `/settings/platform?vault=inference&sub=…`
- Legacy `?tab=search` / `?tab=inference` on `/vault` redirect to Platform Settings
- Legacy `?tab=billing` maps to GodMode Cloud
