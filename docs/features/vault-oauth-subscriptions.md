---
slug: vault-oauth-subscriptions
title: "Vault OAuth subscription providers"
section: "Productivity"
location: "/settings/vault?vault=inference&sub=subscriptions"
summary: "Residual OAuth and product-auth subscription providers for Vault. Documents what OSS can ship without registered app credentials, and operator ToS notes."
---

# Vault OAuth subscription providers

API-key subscription cards (Cursor, Z.AI Coding Plan, OpenCode Go/Zen, MiniMax Token Plan, Kimi Code, Poe, DigitalOcean Inference, Snowflake Cortex PAT) are documented in [Vault](./vault.md). This page covers **#355** providers that need OAuth, device-code, or product auth that public OSS cannot complete without operator-registered apps.

## Doctrine

- Do not ship non-functional Connect buttons.
- Do not commit OAuth client secrets into the public repo.
- Prefer env-based client id/secret + redirect URIs on the host (same pattern as GitHub App Connect).
- Per-tenant credentials only. Never pool consumer subscription tokens on Cloud.
- When a provider also offers a PAT or model access key, ship that Connect path first (DigitalOcean Inference and Snowflake Cortex PAT are the examples).

## Residual matrix

| Provider | Auth needed | OSS status | Blocker |
|----------|-------------|------------|---------|
| GitHub Copilot | Device code and/or Copilot SDK | Deferred | Needs Copilot product auth distinct from GitHub App Projects Connect; device-code poller not in Bridge yet |
| ChatGPT Codex | OAuth (consumer / Plus/Pro/Team) | Deferred | Grey ToS for third-party use of consumer ChatGPT auth. See operator notes below before any Connect UX |
| GitLab Duo | OAuth (Premium/Ultimate + Duo Agent Platform) | Deferred | Operator must register a GitLab OAuth app; redirect `{AUTH_PUBLIC_URL}/api/integrations/gitlab/callback` (planned) |
| xAI SuperGrok / X Premium | OAuth preferred | Deferred | Metered console key already ships under API Keys (`xai-api-key`). Premium OAuth is separate |
| Snowflake Cortex | Browser OAuth or PAT | PAT Connect shipped | PAT + account URL ships under Vault Subscriptions. Browser OAuth still deferred |
| DigitalOcean Inference | Account OAuth / model access key | Model access key shipped | Connect card uses Inference model access key at `https://inference.do-ai.run/v1`. Account OAuth not required |
| Amazon Q Developer / Kiro | AWS Builder ID / product auth | Deferred (optional) | High auth complexity; optional per #230 |

## Env-based OAuth setup (when a provider ships)

Reuse the GitHub Connect shape (`apps/bridge/src/routes/github-integration.ts`):

1. Operator registers an OAuth app with the provider.
2. Set host env: `OAUTH_<PROVIDER>_CLIENT_ID`, `OAUTH_<PROVIDER>_CLIENT_SECRET`.
3. Redirect URI: `{AUTH_PUBLIC_URL}/api/integrations/<provider>/callback`.
4. Vault card starts authorize → Bridge stores per-tenant tokens in Platform Vault → Apply routes into Intelligence with a transport harness (#232).

Until those env vars are set, Connect must stay unavailable (clear empty state), not a stub that fails after click.

## ChatGPT Codex operator notes (ToS)

OpenAI’s consumer ChatGPT subscription OAuth is a **grey area** for third-party products:

- Tokens must stay **per-user / per-tenant**. Never pool ChatGPT consumer credentials across Cloud seats.
- Document the risk for self-host operators before enabling any Codex OAuth Connect surface.
- Prefer OpenAI Platform API keys (metered BYOK already shipped) when ToS clarity matters more than “use your ChatGPT plan.”
- Do not ship Codex OAuth Connect in OSS until product explicitly accepts the grey ToS residual.

## Related

- Parent: [#230](https://github.com/ReBoticsAI/GodMode/issues/230), [#355](https://github.com/ReBoticsAI/GodMode/issues/355), epic [#321](https://github.com/ReBoticsAI/GodMode/issues/321)
- Harness: [Harness profiles](./harness-profiles.md)
- Sign-in / GitHub App env: [Configuration](../CONFIGURATION.md)
