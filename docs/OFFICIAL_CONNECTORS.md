# Official connector quality bar

Official connectors are ReBotics-curated account links and Marketplace packs that
extend GodMode without forking core. They are not one-off brittle scripts: they
must meet this quality bar before they count as Official on Cloud.

This document is the written bar for [#434](https://github.com/ReBoticsAI/GodMode/issues/434).
Related: Marketplace Official catalog ([MARKETPLACE.md](MARKETPLACE.md),
[#380](https://github.com/ReBoticsAI/GodMode/issues/380)), capability grants
([SECURITY.md](SECURITY.md) trust tiers), and Community process sandbox design
([PLUGIN_ISOLATION.md](PLUGIN_ISOLATION.md),
[#314](https://github.com/ReBoticsAI/GodMode/issues/314)).

**Not this document:** the local hardware/federation process under `apps/connector`
([features/connector.md](features/connector.md)). That is a different product surface.

## What counts as an Official connector

| Kind | Where it lives | Examples |
|------|----------------|----------|
| **Vault Connect** | Core Bridge + Vault / AI Settings | GitHub App user OAuth (token store, refresh, disconnect) |
| **Official Marketplace plugin/pack** | Curated Official catalog pin + plugin repo | `godmode-plugin-github`, `godmode-plugin-git` |
| **Both (preferred for hosts)** | Connect for secrets + Official pack for vendor tools | GitHub: Connect auth, Official plugin for `gh`-based helpers |

External calendar/mail/knowledge sync connectors belong in plugins under epic
[#375](https://github.com/ReBoticsAI/GodMode/issues/375). They must still meet
this bar before shipping as Official.

## Quality bar checklist

Every Official connector must document and implement:

### 1. Auth

- Prefer **Vault Connect** (or another Vault-backed secret) over pasting tokens into chat.
- Document required App / OAuth setup (`CONFIGURATION.md` / feature page).
- Human-facing connect UX in Vault or Settings (not only env vars).
- On Cloud, connect must work for tenants without operator shell access.

### 2. Refresh

- Access tokens that expire must refresh automatically when a refresh token exists.
- Failed refresh must surface a clear reconnect path (status badge / Connect card), not silent tool failures forever.

### 3. Scopes / permissions

- Least privilege: declare the App permissions or OAuth scopes the product needs.
- For Vault GitHub Connect on Cloud: document Contents write (Releases), Pull requests write (PR create), Issues write, Projects write, and Metadata read. See `CONFIGURATION.md`.
- On permission failures (`Resource not accessible by integration`), Attention / connector UI must tell the user to reconnect and accept the new install permissions.
- Do not request broad admin scopes "just in case."
- Document what agents can do once connected (clone, PR create, read issues, and so on).

### 4. Webhooks (when inbound events are part of the product)

- Verify signatures (HMAC / provider equivalent) on raw bodies.
- Reject unsigned or invalid payloads fail-closed.
- Document the public callback path and required secrets.

### 5. Rate limits and failure UX

- Respect provider rate limits; back off or fail with actionable errors.
- Surface provider errors in Attention / tool results with enough detail to reconnect or retry.
- Do not hang agents on unbounded retries.

### 6. Teardown

- Explicit disconnect / uninstall path that clears stored tokens or revokes Marketplace grants.
- Disconnect must not leave live webhook subscriptions claiming to act for the tenant without credentials (document residual App install if the provider keeps it).

### 7. Capability grants (Marketplace plugins)

- Official/Community installs are **deny-by-default** for network, tools, and records ([#290](https://github.com/ReBoticsAI/GodMode/issues/290) / [#303](https://github.com/ReBoticsAI/GodMode/issues/303)).
- Catalog and/or manifest must declare `networkHosts` / `toolNames` / `recordNames` (or `capabilities.*`) for anything the plugin registers or fetches.
- Last-tenant uninstall revokes `godmode.capabilities.json`. Kill switches ([#96](https://github.com/ReBoticsAI/GodMode/issues/96)) remain the emergency stop.

### 8. Cloud install pin

- Marketplace plugins ship with immutable `pluginRef` (tag or commit); optional `pluginDigest` fail-closed on drift ([#177](https://github.com/ReBoticsAI/GodMode/issues/177) / [#292](https://github.com/ReBoticsAI/GodMode/issues/292)).
- No floating `main` on Official Cloud rows.

### 9. Docs and smoke

- Feature page or section: connect, use, disconnect, failure modes.
- [VERIFICATION.md](VERIFICATION.md) (or Cloud admin smoke) covers install / connect / one happy path / teardown.

## Reference: GitHub meets the bar

GitHub is the first Official connector held to this bar end to end on Cloud.

| Bar item | GitHub (core Connect + Official plugin) |
|----------|-----------------------------------------|
| Auth | Vault **Connect GitHub** (GitHub App user auth). UI: AI Settings / Vault Connect card. |
| Refresh | `refreshGithubUserToken` when `expiresAt` + refresh token present (`github-integration`). |
| Scopes | App permissions: Contents write (Releases + private clone), Pull requests write, Issues write, Projects write, Metadata read. Documented in CONFIGURATION.md. Legacy OAuth scope string only when App auth is not configured. Reconnect UX on Connect card + `/releases` when Contents write is missing. |
| Webhooks | GitHub App webhook HMAC verification (`github-app-webhook`); raw body; signature fail-closed. |
| Rate limits / UX | Provider errors returned on Connect status and coding/host tools; PR create confirm + Attention. |
| Teardown | `POST /integrations/github/disconnect` clears stored user tokens. |
| Capability grants | Official `godmode-plugin-github` install uses Marketplace pins + deny-by-default grants; declare `toolNames` / hosts in catalog or manifest when the plugin registers tools or calls `externalFetch`. |
| Cloud pin | Official catalog entry pinned by commit/tag on GodMode-Marketplace / SaaS Official rows. |
| Docs / smoke | [features/git-github-plugins.md](features/git-github-plugins.md), [CONFIGURATION.md](CONFIGURATION.md) `GITHUB_APP_*`, VERIFICATION Marketplace + Connect coding path. |

Core already owns the local git cycle and Connect-backed `git_clone` / `github_pr_create`.
The Official GitHub Marketplace plugin adds vendor CLI helpers; it does not replace Connect auth.

## Capability grants and sandbox expectations (#314)

Official Marketplace plugins use the same **deny-by-default grants** as Community
(#290 / #303). Grants are inner policy forever. Hard isolation for untrusted
Community installs is a child process (message-only host API), not this quality
bar. Design, residual threats, cost/ops, and the runner follow-up:

[PLUGIN_ISOLATION.md](PLUGIN_ISOLATION.md)
([#314](https://github.com/ReBoticsAI/GodMode/issues/314) design,
[#559](https://github.com/ReBoticsAI/GodMode/issues/559) implementation).

Official connectors remain ReBotics-curated and stay **in-process** until that
Community runner is proven. Do not treat this document as the plugin sandbox spec.

## Marketplace Official tab (#380)

The Official tab is a real curated catalog (packs + Official plugins), not a stub.
On GodMode Cloud it is served from `marketplace_official_catalog` (synced from the
public free index when admins run sync-from-public). Self-host may use the public
GitHub raw index or `MARKETPLACE_LOCAL_CATALOG_PATH` / sibling clone for local dev.

Empty Official results on Cloud mean feed/network/admin curation problems, not
"set a local catalog path." See [features/marketplace.md](features/marketplace.md).

## Author checklist (before marking Official)

1. Auth + refresh + teardown paths reviewed against the table above.
2. Webhooks signature-verified if inbound events are in scope.
3. Manifest/catalog capability names match registered tools and `externalFetch` hosts.
4. Official catalog pin + optional digest on Cloud.
5. Feature docs + VERIFICATION smoke updated.
6. No operator PII, private plugin deps, or domain residue in public core.

See also [PLUGIN_AUTHORING.md](PLUGIN_AUTHORING.md) and [SECURITY.md](SECURITY.md).
