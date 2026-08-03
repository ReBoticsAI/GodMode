---
slug: vault
title: "Vault"
section: "Productivity"
location: "/vault"
summary: "Connect hub for GodMode Cloud, inference, integrations, wallets, marketplace, secrets, and storage."
---
# Vault

![vault in GodMode](/features/vault.png)

Vault is the connect hub for credentials and account connects. Chat → Vault tab gives quick access while chatting.

## Tabs

### Inference

Subtabs: **Subscriptions**, **API Keys**, and **Search**.

#### Subscriptions

Use your plan (billed by the provider). **Cursor** Connect stores a fixed `cursor-api-key` and applies Cursor harness profiles in Intelligence.

#### API Keys

Metered BYOK with named Connect cards:

| Provider | Secret id | Harness profile | Docs |
|----------|-----------|-----------------|------|
| OpenAI Platform | `openai-api-key` | `openai` | [Function calling](https://platform.openai.com/docs/guides/function-calling) |
| Anthropic Console | `anthropic-api-key` | `anthropic` | [Tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview) |
| OpenRouter | `openrouter-api-key` | `openrouter-*` family (from model slug) | [OpenRouter](https://openrouter.ai/docs) |
| Groq | `groq-api-key` | `groq-*` family (from model id) | [Groq](https://console.groq.com/docs/openai) |
| Together | `together-api-key` | `together-*` family (from model id) | [Together](https://docs.together.ai/docs/inference/openai-compatibility) |

OpenRouter catalog on the card is a usage top-10 snapshot (2026-08-03) plus a custom model slug. Runtime uses `openai_compatible` with `https://openrouter.ai/api/v1`. Harness is transport + family (for example `openrouter-deepseek`), not one profile for every OpenRouter model.

Groq catalog is a production chat snapshot (2026-08-03) plus a custom model id. Runtime uses `openai_compatible` with `https://api.groq.com/openai/v1`. Family examples: `groq-llama`, `groq-gpt-oss`, `groq-compound`.

Together catalog is a serverless chat snapshot (2026-08-03) plus a custom model id. Runtime uses `openai_compatible` with `https://api.together.ai/v1`. Family examples: `together-llama`, `together-deepseek`, `together-minimax`.

Each card Connect / Disconnect / Apply wires catalog models and a transport-specific harness (`profile = f(backend, provider, family)`). See [[harness-profiles]].

#### Search

Web search and URL fetch keys for agents.

**Exa** Connect stores Vault secret `exa_api_key` (Connect / Disconnect / Connected badge). No Intelligence harness Apply; Exa is for `web_search` and `fetch_url` only.

1. Sign up at [dashboard.exa.ai](https://dashboard.exa.ai) and create an API key.
2. Connect the key on Vault → Inference → Search → Exa (or still paste under All Secrets as `exa_api_key` / agent provider `exa`).
3. If Exa blocks for exhausted credits, add credits or wait for the monthly free refresh at [Exa billing](https://dashboard.exa.ai/billing). GodMode surfaces the error and does not retry against a dead balance.

GodMode Cloud routes agent `web_search` and `fetch_url` through [Exa](https://exa.ai) so egress uses Exa's network instead of the shared VPS IP. Cloud requires **tenant BYOK** (no platform shared key).

Self-host / local: Exa is optional. When `exa_api_key` (or agent provider `exa`) is present, web tools use Exa; otherwise they keep the DuckDuckGo / direct-fetch fallback.

See [[cursor-cloud]].

### All Secrets

Free-form platform secrets (the AI Platform Secrets card) shared across agents. Prefer named Connect cards when one exists.

### Marketplace

Seller **Stripe Connect** for Community payouts. Marketplace → Sell dual-mounts the same Seller payouts card so publish gating still works next to ToS Accept and listing tools. PayPal and crypto seller rails stay disabled for v1.

1. Open Vault → Marketplace (or Marketplace → Sell).
2. Choose Connect with Stripe. Return/refresh lands on the page you started from (`/vault?tab=marketplace` or `/marketplace?tab=seller`).
3. Optional: paste an `acct_…` id under advanced fields and save.
4. On Sell, accept ToS (if needed), then publish. Paid listings require a connected payout.

### Wallets

Moralis and PayPal **API credentials** for live Bank / wallet sync. Wallet connect and PayPal balance link flows stay on Bank. Bank keeps a dual-home link to this tab.

1. Open Vault → Wallets.
2. Save and test a Moralis Web3 API key for crypto portfolios.
3. Save and test PayPal business app credentials (sandbox or live) for balance sync.
4. Return to Bank to connect wallets or PayPal balances.

### GodMode Cloud

GodMode Cloud seat billing (Stripe Customer Portal). Shown only on SaaS hosts; the card is hidden on self-host / local.

The **Subscription** card opens Stripe to manage plan, payment method, and invoices. Settings keeps a short dual-home link to this tab.

1. Open Vault → GodMode Cloud.
2. Choose Manage subscription to open the Stripe Customer Portal.
3. After leaving the portal, you return to Vault → GodMode Cloud.

Provider LLM subscriptions (for example Cursor) stay under Inference → Subscriptions. They are not GodMode Cloud seats.

### Integrations

#### GitHub

The **Connect GitHub** card installs and authorizes the GitHub App used for Projects sync (and Cloud sign-in when configured). Settings keeps a short dual-home link to this tab.

1. Open Vault → Integrations → Connect GitHub.
2. Install the App on the account that owns your Projects, then authorize.
3. Open Tasks → Board settings to link a Project.

### Storage

Database and data-store sizes. Monitor growth before trimming or upgrading stores.

## Route

`/vault` (deep-link tabs: `?tab=cloud|inference|integrations|wallets|marketplace|secrets|storage`; Inference subtabs: `?tab=inference&sub=subscriptions|api-keys|search`; default `inference` / `subscriptions`). Legacy `?tab=search` maps to Inference → Search; `?tab=billing` maps to GodMode Cloud.
