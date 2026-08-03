---
slug: vault
title: "Vault"
section: "Productivity"
location: "/vault"
summary: "Connect hub for inference, search, and storage."
---
# Vault

![vault in GodMode](/features/vault.png)

Vault is the connect hub for credentials and storage. Chat → Vault tab gives quick access while chatting. Inference and Search are available today; more connect tabs are coming.

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

### Storage

Database and data-store sizes. Monitor growth before trimming or upgrading stores.

## Route

`/vault`
