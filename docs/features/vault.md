---
slug: vault
title: "Vault"
section: "Productivity"
location: "/vault"
summary: "Connect hub for inference, search, integrations, billing, and storage."
---
# Vault

![vault in GodMode](/features/vault.png)

Vault is the connect hub for credentials, integrations, billing, and storage. Chat → Vault tab gives quick access while chatting. Inference, Search, Integrations, and Billing are available today; more connect tabs are coming.

## Tabs

### Inference

Subscriptions and metered LLM API keys for Intelligence.

#### Subscriptions

Use your plan (billed by the provider). **Cursor** Connect stores a fixed `cursor-api-key` and applies Cursor harness profiles in Intelligence.

#### API keys

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

The free-form **AI platform secrets** card remains on Inference for keys without a dedicated Connect card.

### Search

Web search and URL fetch keys for agents.

#### Exa

The **Exa** Connect card stores Vault secret `exa_api_key` (Connect / Disconnect / Connected badge). No Intelligence harness Apply; Exa is for `web_search` and `fetch_url` only.

1. Sign up at [dashboard.exa.ai](https://dashboard.exa.ai) and create an API key.
2. Connect the key on Vault → Search → Exa (or still paste as secret name `exa_api_key` / agent provider `exa`).
3. If Exa blocks for exhausted credits, add credits or wait for the monthly free refresh at [Exa billing](https://dashboard.exa.ai/billing). GodMode surfaces the error and does not retry against a dead balance.

GodMode Cloud routes agent `web_search` and `fetch_url` through [Exa](https://exa.ai) so egress uses Exa's network instead of the shared VPS IP. Cloud requires **tenant BYOK** (no platform shared key).

Self-host / local: Exa is optional. When `exa_api_key` (or agent provider `exa`) is present, web tools use Exa; otherwise they keep the DuckDuckGo / direct-fetch fallback.

See [[cursor-cloud]].

### Integrations

Third-party account connects that are not inference or search keys.

#### GitHub

The **Connect GitHub** card installs and authorizes the GitHub App used for Projects sync (and Cloud sign-in when configured). Settings keeps a short dual-home link to this tab.

1. Open Vault → Integrations → Connect GitHub.
2. Install the App on the account that owns your Projects, then authorize.
3. Open Tasks → Board settings to link a Project.

#### Holdings

Moralis and PayPal **API credentials** for live Bank / Holdings sync live here. Wallet connect and PayPal balance link flows stay on Bank / Holdings. Bank keeps a dual-home link to this tab.

1. Open Vault → Integrations → Holdings.
2. Save and test a Moralis Web3 API key for crypto portfolios.
3. Save and test PayPal business app credentials (sandbox or live) for balance sync.
4. Return to Bank to connect wallets or PayPal balances.

### Billing

GodMode Cloud seat billing (Stripe Customer Portal). Shown only on SaaS hosts; the card is hidden on self-host / local.

The **Subscription** card opens Stripe to manage plan, payment method, and invoices. Settings keeps a short dual-home link to this tab.

1. Open Vault → Billing.
2. Choose Manage subscription to open the Stripe Customer Portal.
3. After leaving the portal, you return to Vault → Billing.

Provider LLM subscriptions (for example Cursor) stay under Inference. They are not GodMode Cloud seats.

### Storage

Database and data-store sizes. Monitor growth before trimming or upgrading stores.

## Route

`/vault` (deep-link tabs: `?tab=inference|search|integrations|billing|storage`; default `inference`)
