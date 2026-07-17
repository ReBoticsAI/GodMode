# Marketplace

GodMode Marketplace installs packs and plugins from catalogs, and (on GodMode Cloud) supports **paid Official** items and **user-to-user** listings with real-money checkout.

![Official catalog tab](assets/readme/marketplace.png)

## Product rules

- **No credits** — purchases are USD (or crypto) via Stripe, PayPal, or MetaMask-compatible checkout.
- **Official items** — merchant of record is ReBotics/GodMode; **100%** of Official revenue to the platform.
- **User listings** — sellers connect Stripe Connect, PayPal, and/or MetaMask; platform takes **10%**.
- **ToS** — see [MARKETPLACE_TOS.md](MARKETPLACE_TOS.md). Chargeback ⇒ permanent Marketplace ban (no buy, no earn).
- **Surfaces** — SaaS is the commerce authority. Local and private-hub installs pull the curated Official feed (and checkout against SaaS when an item is paid).

## Official catalog

Default free/OSS index (fallback):

- `https://raw.githubusercontent.com/ReBoticsAI/GodMode-Marketplace/main/catalog/index.json`
- Override with `MARKETPLACE_OFFICIAL_URL`
- Local sibling `../GodMode-Marketplace/catalog/index.json` auto-detected in dev

On **GodMode Cloud** (`INSTALLATION_SURFACE=saas`), Official entries are curated in `marketplace_official_catalog` (admin API) and served at:

- Authenticated: `GET /api/marketplace/catalog/official`
- Public (local/private-hub pulls): `GET /api/marketplace/commerce/catalog/official/public`

Point non-SaaS installs at the public URL with `MARKETPLACE_SAAS_OFFICIAL_URL` / `MARKETPLACE_OFFICIAL_URL` so they see ReBotics-selected prices.

Open **Marketplace → Official** to browse. Free entries install immediately. Paid entries require checkout (card / PayPal / crypto), then **Install if owned**.

## Kernel commerce

Durable buy/sell uses ObjectTypes (see [OBJECTTYPE_KERNEL.md](OBJECTTYPE_KERNEL.md)):

| ObjectType | Actions |
|---|---|
| `MarketplaceListing` | `publish`, `acquire`, `archive`, … (`price_cents`) |
| `MarketplaceOrder` | `start_checkout`, `capture_paypal`, `confirm_crypto` |
| `MarketplaceSellerAccount` | `accept_tos`, `connect_payout`, `commerce_config` |
| `CatalogInstall` | `install_entry` (gates paid Official entries) |

Payment provider webhooks and the public Official JSON feed are **protocol exceptions**, not parallel Express CRUD.

## Sell tab

**Marketplace → Sell**: accept ToS, connect Stripe Connect / PayPal merchant id / MetaMask address, then publish listings via kernel `MarketplaceListing.publish` with `price_cents`.

## Unofficial / private

**Marketplace → Unofficial** remains free local folders, `file://` catalogs, and third-party indexes (same schema as Official, typically `priceCents: 0`).

## Related

- [MARKETPLACE_TOS.md](MARKETPLACE_TOS.md)
- [CONFIGURATION.md](CONFIGURATION.md)
- [PLUGIN_AUTHORING.md](PLUGIN_AUTHORING.md)
