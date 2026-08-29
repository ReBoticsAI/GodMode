---
slug: marketplace
title: "Marketplace"
section: "Social and extension"
location: "/marketplace"
summary: "Install Official/Community packs; sell from Self-Hosted with a Seller seat; real-money commerce on Cloud."
---
# Marketplace

![marketplace in GodMode](/features/marketplace.png)


Marketplace is how you **connect** specialty packs into GodMode without forking core. On Cloud it supports paid Official items and user-to-user Community listings with real-money commerce. Cloud installs stay on the Official and Community path; arbitrary Local plugin folders are a self-host option, not available on Cloud.

## Tabs

| Tab | Role |
|-----|------|
| Official | Curated ReBotics catalog (free + paid). Paid revenue is 100% to the platform. |
| Local | Local plugin folders and third-party indexes (typically free). Self-host / desktop; not available as arbitrary folders on Cloud. |
| Community | User listings and catalog plugins. Sellers keep 90%; platform takes 10%. |
| Installed | Workspace plugins and install history. |
| Sell | Seller dashboard: ToS, payouts, publish wizard, My listings. |

## Product rules

- No credits. Purchases are USD (or crypto) via Stripe, PayPal, or MetaMask-compatible checkout.
- Pack purchases are separate from a Cloud subscription.
- SaaS is the commerce authority for paid Community listings.
- Chargebacks lead to a permanent Marketplace ban.

## Self-Hosted sellers (GodMode Seller seat)

Run GodMode on **your machine** and earn on the **Community** Marketplace without a full Cloud workspace.

- **GodMode Seller** (~$4.99/mo) is a commerce seat only. It does not include a full Cloud workspace.
- Your workspace data stays on your Self-Hosted install. Marketplace → **Sell** is where you publish and manage listings locally.
- GodMode Cloud is the commerce authority for paid Community sales (Seller seat, Stripe Connect, listing records, 10% platform fee). Self-Hosted alone is not merchant of record for paid Community listings.
- Unlock Local Sell with the checklist: Seller seat → GitHub Connect → Stripe Connect → Marketplace ToS.
- Full Cloud workspace subscribers use the existing Sell tab without a separate Seller gate.

See [MARKETPLACE.md](../MARKETPLACE.md) for the full seller, catalog, and payout rules.

## Official connectors

Official is a real curated feed (starter packs plus Official plugins such as Git
and GitHub), not an empty tab. Account-link and host connectors must meet the
written quality bar in [OFFICIAL_CONNECTORS.md](../OFFICIAL_CONNECTORS.md).
GitHub Vault Connect plus the Official GitHub plugin is the Cloud reference.

On Cloud, an empty Official tab means network or admin catalog sync issues. It
does not mean setting a local catalog path (that hint is self-host / local dev
only).

## Seller payouts

Vault → Marketplace is the connect home for seller Stripe Connect. Marketplace → Sell links there for Connect; ToS Accept, Publish, and My listings stay on Sell. See [[vault]].

## Route

`/marketplace`

See [[plugin-pipeline]] and [[git-github-plugins]].
