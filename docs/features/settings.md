---
slug: settings
title: "Settings"
section: "Social and extension"
location: "/settings"
summary: "Account, appearance, storage, and session settings. User Vault is a separate sidebar page."
---
# Settings

![settings in GodMode](/features/settings.png)


Settings covers account, appearance, storage, and session preferences. Platform credentials live on **User Vault** (sidebar, between Admin and Settings).

## Tabs

- **General**: account, MFA, appearance, session, and a link to User Vault
- **Storage**: database / data-store usage, workspace data export (SaaS owners)

## User Vault

Shared platform credentials for the workspace live on their own page (`/settings/vault`):

- **GodMode Cloud** (SaaS seat billing / Stripe Customer Portal)
- **Inference → Subscriptions** (for example Cursor)
- **Inference → API Keys** (OpenAI, Anthropic, OpenRouter, Groq, Together)
- **Inference → Search** (Exa)
- **All Secrets** (free-form Platform secrets)

Agents resolve LLM and Exa keys as **Agent secrets → User Vault**. Personal connects (GitHub, wallets and accounts, marketplace) stay on [[vault]]. Inference Connect cards are Platform-only.

Deep links: `/settings/vault?vault=cloud|inference|secrets` (Inference: `&sub=subscriptions|api-keys|search`).

Legacy `/settings/platform?tab=vault&…` redirects to User Vault.

## Storage tab

- **Storage usage**: database and data-store sizes (monitor growth before trimming or upgrading stores)
- **Workspace data**: owner self-serve SQLite export on SaaS hosts (download a consistent snapshot to run GodMode locally)

Deep link: `/settings/platform?tab=storage`.

Legacy `/vault?tab=storage` redirects here.

## Route

`/settings` (platform settings: `/settings/platform`)

Admin surfaces (including Updates) live under admin settings for privileged users ([[admin-updates]]).
