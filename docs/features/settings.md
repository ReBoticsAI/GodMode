---
slug: settings
title: "Settings"
section: "Social and extension"
location: "/settings"
summary: "Account, appearance, Platform Vault, and session settings."
---
# Settings

![settings in GodMode](/features/settings.png)


Settings covers account, appearance, Platform Vault, and session preferences.

## Platform Vault

Shared inference credentials for the workspace:

- **Inference → Subscriptions** (for example Cursor)
- **Inference → API Keys** (OpenAI, Anthropic, OpenRouter, Groq, Together)
- **Inference → Search** (Exa)
- **All Secrets** (free-form Platform secrets)

Agents resolve LLM and Exa keys as **Agent Vault → Platform Vault**. Personal connects (GitHub, Cloud seats, wallets, marketplace) stay on [[vault]].

Deep links: `/settings/platform?vault=inference&sub=subscriptions|api-keys|search` or `?vault=secrets`.

## Dual-home links

GitHub and GodMode Cloud billing live in the User [[vault]]. Settings keeps short dual-home links to **Vault → Integrations** and **Vault → GodMode Cloud**.

## Route

`/settings` (platform settings: `/settings/platform`)

Admin surfaces (including Updates) live under admin settings for privileged users ([[admin-updates]]).
