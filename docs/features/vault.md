---
slug: vault
title: "Vault"
section: "Productivity"
location: "/vault"
summary: "Subscriptions, metered API keys, and storage."
---
# Vault

![vault in GodMode](/features/vault.png)

Vault stores inference credentials and storage usage. Chat → Vault tab gives quick access while chatting.

## Sections

### Subscriptions

Use your plan (billed by the provider). **Cursor** Connect stores a fixed `cursor-api-key` and applies Cursor harness profiles in Intelligence.

### API keys

Metered BYOK with named Connect cards:

| Provider | Secret id | Harness profile | Docs |
|----------|-----------|-----------------|------|
| OpenAI Platform | `openai-api-key` | `openai` | [Function calling](https://platform.openai.com/docs/guides/function-calling) |
| Anthropic Console | `anthropic-api-key` | `anthropic` | [Tool use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview) |
| OpenRouter | `openrouter-api-key` | `openrouter-*` family (from model slug) | [OpenRouter](https://openrouter.ai/docs) |

OpenRouter catalog on the card is a usage top-10 snapshot (2026-08-03) plus a custom model slug. Runtime uses `openai_compatible` with `https://openrouter.ai/api/v1`. Harness is transport + family (for example `openrouter-deepseek`), not one profile for every OpenRouter model.

Each card Connect / Disconnect / Apply wires catalog models and a transport-specific harness (`profile = f(backend, provider, family)`). See [[harness-profiles]].

Generic secrets (for example Exa `exa_api_key`) remain available under the free-form secrets card.

## Route

`/vault`

## Exa (web_search / fetch_url)

GodMode Cloud routes agent `web_search` and `fetch_url` through [Exa](https://exa.ai) so egress uses Exa's network instead of the shared VPS IP. Cloud requires **tenant BYOK** (no platform shared key):

1. Sign up at [dashboard.exa.ai](https://dashboard.exa.ai) and create an API key.
2. Paste the key in Vault as secret name `exa_api_key`, or add provider `exa` under the agent's API keys (Agent accounts).
3. If Exa blocks for exhausted credits, add credits or wait for the monthly free refresh at [Exa billing](https://dashboard.exa.ai/billing). GodMode surfaces the error and does not retry against a dead balance.

Self-host / local: Exa is optional. When `exa_api_key` (or agent provider `exa`) is present, web tools use Exa; otherwise they keep the DuckDuckGo / direct-fetch fallback.

See [[cursor-cloud]].
