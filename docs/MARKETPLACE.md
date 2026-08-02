# Marketplace

GodMode Marketplace installs packs and plugins from catalogs, and (on GodMode Cloud) supports **paid Official** items and **user-to-user Community** listings with real-money checkout.

![Official catalog tab](assets/readme/marketplace.png)

## Tabs

| Tab | Role |
|-----|------|
| **Official** | Curated ReBotics catalog (free + paid). Paid revenue is **100%** to the platform. |
| **Local** | Local plugin folders and third-party catalog URLs (typically free). HTTP paths remain `/marketplace/catalog/unofficial`. |
| **Community** | Browse and buy **user listings** (`seller_kind = user`). Checkout uses `listingId`. |
| **Installed** | Workspace plugins + install history. |
| **Sell** | Accept ToS, connect payouts, **publish** listings, and manage **my listings**. |

## Product rules

- **No credits** — purchases are USD (or crypto) via Stripe, PayPal, or MetaMask-compatible checkout.
- **Official items** — merchant of record is ReBotics/GodMode; **100%** of Official revenue to the platform.
- **Community (user) listings** — sellers connect Stripe Connect, PayPal, and/or MetaMask; platform takes **10%**.
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

### Buyer install pins (#177)

Official and Community **plugin** installs fail closed unless the catalog entry
sets an immutable `pluginRef` (release tag or commit sha). Optional
`pluginDigest` (commit sha) must match `git rev-parse HEAD` after checkout.
Floating refs (`main` / `master`) are rejected for those catalogs. Local folder
registration (self-host / Unofficial) stays operator-trusted and does not use
this pin gate.

Intake CI smoke does not replace install pins or runtime least privilege.
Runtime capability allowlists (#290 network, #303 tools/records): Official/Community
installs are **deny-by-default** for network, tools, and records. Catalog fields
(`networkHosts`, `toolNames`, `recordNames`) and/or manifest
`capabilities.{network,tools,records}` are granted at install into
`godmode.capabilities.json`. Plugins must use `host.externalFetch` for outbound
http(s), and may only register/call tools and ObjectTypes named in the grant.
Manifest `objectTypes` names are also collected into the records grant. Local
folder / operator path installs stay unrestricted. Last-tenant uninstall revokes
the grants file; kill switches (#96) remain the emergency stop.

## Community (user-to-user)

1. Seller: **Sell** → accept ToS → connect payout (required for paid) → publish with kind, title, price, delivery (`clone` or `live`), and source resource id.
2. Buyer: **Community** → browse public `seller_kind=user` listings → free **Acquire**, or paid checkout with `listingId`, then acquire.
3. After a successful acquire, matching paid orders move to `delivered`.

Public browse: `GET /api/marketplace/listings?seller_kind=user` (default when `seller_kind` is omitted). Response includes `price_cents`, `currency`, `seller_kind`, and `catalog_entry_id`.

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

**Marketplace → Sell**: accept ToS, connect Stripe Connect / PayPal merchant id / MetaMask address, publish via kernel `MarketplaceListing.publish` with `price_cents`, then manage **My listings** (archive).

## Local catalogs

**Marketplace → Local** is for free local folders, `file://` catalogs, and third-party indexes (same schema as Official, typically `priceCents: 0`). It is not the Community user-listing feed.

## Related

- [MARKETPLACE_TOS.md](MARKETPLACE_TOS.md)
- [CONFIGURATION.md](CONFIGURATION.md)
- [PLUGIN_AUTHORING.md](PLUGIN_AUTHORING.md)
