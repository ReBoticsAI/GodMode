---
slug: vault
title: "Vault"
section: "Productivity"
location: "/vault"
summary: "Secrets, API keys, and Cursor subscription connect."
---
# Vault

![vault in GodMode](/features/vault.png)


Vault stores secrets, API keys, and Cursor subscription connection. Chat → Vault tab gives quick access while chatting.

## Route

`/vault`

## Exa (web_search / fetch_url)

GodMode Cloud routes agent `web_search` and `fetch_url` through [Exa](https://exa.ai) so egress uses Exa's network instead of the shared VPS IP. Cloud requires **tenant BYOK** (no platform shared key):

1. Sign up at [dashboard.exa.ai](https://dashboard.exa.ai) and create an API key.
2. Paste the key in Vault as secret name `exa_api_key`, or add provider `exa` under the agent's API keys (Agent accounts).
3. If Exa blocks for exhausted credits, add credits or wait for the monthly free refresh at [Exa billing](https://dashboard.exa.ai/billing). GodMode surfaces the error and does not retry against a dead balance.

Self-host / local: Exa is optional. When `exa_api_key` (or agent provider `exa`) is present, web tools use Exa; otherwise they keep the DuckDuckGo / direct-fetch fallback.

See [[cursor-cloud]].
