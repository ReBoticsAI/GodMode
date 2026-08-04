---
slug: settings
title: "Settings"
section: "Social and extension"
location: "/settings"
summary: "Account, appearance, Platform Vault, storage, and session settings."
---
# Settings

![settings in GodMode](/features/settings.png)


Settings covers account, appearance, Platform Vault, storage, and session preferences.

## Tabs

- **General**: account, MFA, appearance, session
- **Vault**: Platform Vault (GodMode Cloud, Inference, All Secrets)
- **Storage**: database / data-store usage, workspace data export (SaaS owners)

## Platform Vault (Vault tab)

Shared platform credentials for the workspace:

- **GodMode Cloud** (SaaS seat billing / Stripe Customer Portal)
- **Inference → Subscriptions** (for example Cursor)
- **Inference → API Keys** (OpenAI, Anthropic, OpenRouter, Groq, Together)
- **Inference → Search** (Exa)
- **All Secrets** (free-form Platform secrets)

Agents resolve LLM and Exa keys as **Agent secrets → Platform Vault**. Personal connects (GitHub, wallets and accounts, marketplace) stay on [[vault]]. Inference Connect cards are Platform-only.

Deep links: `/settings/platform?tab=vault&vault=cloud|inference|secrets` (Inference: `&sub=subscriptions|api-keys|search`).

## Storage tab

- **Storage usage**: database and data-store sizes (monitor growth before trimming or upgrading stores)
- **Workspace data**: owner self-serve SQLite export on SaaS hosts (download a consistent snapshot to run GodMode locally)

Deep link: `/settings/platform?tab=storage`.

Legacy `/vault?tab=storage` redirects here.

## Route

`/settings` (platform settings: `/settings/platform`)

Admin surfaces (including Updates) live under admin settings for privileged users ([[admin-updates]]).
