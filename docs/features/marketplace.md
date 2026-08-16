---
slug: marketplace
title: "Marketplace"
section: "Social and extension"
location: "/marketplace"
summary: "Install Official/Community packs; connect anything without forking core; real-money checkout, no credits."
---
# Marketplace

![marketplace in GodMode](/features/marketplace.png)


Marketplace is how you **connect** specialty packs into GodMode without forking core. On Cloud it supports paid Official items and user-to-user Community listings with real-money checkout. Cloud installs stay on the Official and Community path; arbitrary Local plugin folders are a self-host option, not available on Cloud.

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
- SaaS is the commerce authority for paid checkout.
- Chargebacks lead to a permanent Marketplace ban.

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
