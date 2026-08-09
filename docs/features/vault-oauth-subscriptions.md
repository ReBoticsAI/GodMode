---
slug: vault-oauth-subscriptions
title: "Vault OAuth subscription providers"
section: "Productivity"
location: "/settings/vault?vault=inference&sub=subscriptions"
summary: "Residual OAuth and product-auth subscription providers for Vault. Documents #364 foundation, active #355 scope, deferred later work, and out-of-scope Codex."
---

# Vault OAuth subscription providers

API-key subscription cards (Cursor, Z.AI Coding Plan, OpenCode Go/Zen, MiniMax Token Plan, Kimi Code, Poe, DigitalOcean Inference, Snowflake Cortex PAT) are documented in [Vault](./vault.md). This page covers **#355** providers that need OAuth, device-code, or product auth that public OSS cannot complete without operator-registered apps.

Shared authorize / callback / token store / Connect UX plumbing is tracked as **[#364](https://github.com/ReBoticsAI/GodMode/issues/364)** (foundation; blocks provider Connect slices on #355).

## Doctrine

- Do not ship non-functional Connect buttons.
- Do not commit OAuth client secrets into the public repo.
- Prefer env-based client id/secret + redirect URIs on the host (same pattern as GitHub App Connect).
- Per-tenant credentials only. Never pool consumer subscription tokens on Cloud.
- When a provider also offers a PAT or model access key, ship that Connect path first (DigitalOcean Inference and Snowflake Cortex PAT are the examples).

### Local vs Cloud config

- **Local / desktop / bare-metal (and local hub):** operators who want Copilot, GitLab Duo, or SuperGrok register their own OAuth apps with those providers and set client id, secret, and redirect in host env. Connect stays unavailable until env is present.
- **GodMode Cloud (SaaS):** platform operator registers production OAuth apps once; end users only click Connect / Disconnect.

## Active residual (#355)

These remain in scope for #355 Connect work (OAuth / device-code / product auth), after [#364](https://github.com/ReBoticsAI/GodMode/issues/364) foundation lands:

| Provider | Auth needed | OSS status | Blocker |
|----------|-------------|------------|---------|
| GitHub Copilot | Device code and/or Copilot SDK | Active residual | Needs Copilot product auth distinct from GitHub App Projects Connect; device-code poller not in Bridge yet |
| GitLab Duo | OAuth (Premium/Ultimate + Duo Agent Platform) | Active residual | Operator must register a GitLab OAuth app; redirect `{AUTH_PUBLIC_URL}/api/integrations/gitlab/callback` (planned) |
| xAI SuperGrok / X Premium | OAuth preferred | Active residual | Metered console key already ships under API Keys (`xai-api-key`). Premium OAuth is separate |

Snowflake Cortex browser OAuth is optional follow-up only. PAT Connect already ships under Vault Subscriptions. DigitalOcean Inference model access key Connect already ships; account OAuth is not required.

## Deferred / later (not active #355 checklist)

| Provider | Auth needed | Status | Notes |
|----------|-------------|--------|-------|
| Amazon Q Developer / Kiro | AWS Builder ID / product auth | Deferred / later | High auth complexity. Not on the active #355 checklist; may return in a later issue |
| Snowflake Cortex browser OAuth | Browser OAuth | Deferred / later | PAT path already shipped; browser OAuth only if product wants it beyond PAT |

## Out of scope

| Provider | Decision | Reason |
|----------|----------|--------|
| ChatGPT Codex (consumer ChatGPT OAuth) | **Scrapped** | Grey ToS for third-party use of consumer ChatGPT / Plus/Pro/Team auth. Do not plan to ship Codex OAuth Connect. Prefer OpenAI Platform API keys (metered BYOK already shipped) |

## Env-based OAuth setup (when a provider ships)

Reuse the GitHub Connect shape (`apps/bridge/src/routes/github-integration.ts`):

1. Operator registers an OAuth app with the provider.
2. Set host env: `OAUTH_<PROVIDER>_CLIENT_ID`, `OAUTH_<PROVIDER>_CLIENT_SECRET`.
3. Redirect URI: `{AUTH_PUBLIC_URL}/api/integrations/<provider>/callback`.
4. Vault card starts authorize → Bridge stores account User Vault tokens → Apply routes into Intelligence with a transport harness (#232).

Until those env vars are set, Connect must stay unavailable (clear empty state), not a stub that fails after click.

## Related

- Foundation (blocks #355 provider slices): [#364](https://github.com/ReBoticsAI/GodMode/issues/364)
- Parent: [#230](https://github.com/ReBoticsAI/GodMode/issues/230), [#355](https://github.com/ReBoticsAI/GodMode/issues/355), epic [#321](https://github.com/ReBoticsAI/GodMode/issues/321)
- Harness: [Harness profiles](./harness-profiles.md)
- Sign-in / GitHub App env: [Configuration](../CONFIGURATION.md)
