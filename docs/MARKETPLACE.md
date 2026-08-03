# Marketplace

GodMode Marketplace installs packs and plugins from catalogs, and (on GodMode Cloud) supports **paid Official** items and **user-to-user Community** listings with real-money checkout.

![Official catalog tab](assets/readme/marketplace.png)

## Tabs

| Tab | Role |
|-----|------|
| **Official** | ReBotics-curated catalog only (free + paid). Paid revenue is **100%** to the platform. Not a public seller path. |
| **Local** | Local plugin folders and third-party catalog URLs (typically free). HTTP paths remain `/marketplace/catalog/unofficial`. |
| **Community** | **User seller path**: gated Community catalog + in-app user listings (`seller_kind = user`). Checkout uses `listingId` for Sell listings. |
| **Installed** | Workspace plugins + install history. |
| **Sell** | Accept ToS, connect payouts, **publish** Community listings, and manage **my listings**. |

## Product rules

- **One seller path** — public sellers use **Community** (Sell tab and/or `catalog/community/` PRs). Official is ReBotics-only.
- **No credits** — purchases are USD (or crypto) via Stripe, PayPal, or MetaMask-compatible checkout.
- **Official items** — merchant of record is ReBotics/GodMode; **100%** of Official revenue to the platform.
- **Community (user) listings** — sellers connect Stripe Connect, PayPal, and/or MetaMask; platform takes **10%**.
- **ToS** — see [MARKETPLACE_TOS.md](MARKETPLACE_TOS.md). Chargeback ⇒ permanent Marketplace ban (no buy, no earn).
- **Surfaces** — SaaS is the commerce authority. Local and private-hub installs pull the curated Official feed (and checkout against SaaS when an item is paid).

## Official catalog

Default free/OSS Official index:

- `https://raw.githubusercontent.com/ReBoticsAI/GodMode-Marketplace/main/catalog/official/index.json`
- Legacy alias (synced): `.../catalog/index.json`
- Override with `MARKETPLACE_OFFICIAL_URL`
- Local sibling `../GodMode-Marketplace/catalog/official/index.json` auto-detected in dev

Community gated index (user sellers):

- `https://raw.githubusercontent.com/ReBoticsAI/GodMode-Marketplace/main/catalog/community/index.json`
- Override with `MARKETPLACE_COMMUNITY_URL`
- Bridge: `GET /api/marketplace/catalog/community`

On **GodMode Cloud** (`INSTALLATION_SURFACE=saas`), Official entries are curated in `marketplace_official_catalog` (admin API) and served at:

- Authenticated: `GET /api/marketplace/catalog/official`
- Public (local/private-hub pulls): `GET /api/marketplace/commerce/catalog/official/public`

Point non-SaaS installs at the public URL with `MARKETPLACE_SAAS_OFFICIAL_URL` / `MARKETPLACE_OFFICIAL_URL` so they see ReBotics-selected prices.

Open **Marketplace → Official** to browse. Free entries install immediately. Paid entries require checkout (card / PayPal / crypto), then **Install if owned**.

### Seller intake verify (Community)

Public **Community** catalog PRs for `installType: "plugin"` require a public
`pluginRepo`, an immutable `pluginRef` (tag or commit), and a green reusable
GitHub Actions verify run (`ciRunUrl`). Sellers copy
`examples/seller-plugin-verify.yml` from
[GodMode-Marketplace](https://github.com/ReBoticsAI/GodMode-Marketplace)
and call
`.github/workflows/reusable-plugin-verify.yml`. Add entries to
`catalog/community/index.json` (not Official). Catalog validate rejects
floating refs; set `MARKETPLACE_REQUIRE_PLUGIN_CI=1` for fail-closed
`ciRunUrl` checks. See Marketplace CONTRIBUTING for the seller checklist.

### Official Verified badge

Official is ReBotics-curated and does **not** require Verified badges. Cards only
show Verified when `verifiedPublisher` is explicitly true. Community seller
trust uses seller-account earned tiers and admin freeze/floor (#311, #313), not Official defaults.

### Community verified seller (#311 / #313)

Community (user) sellers earn **Verified** badges from the count of **gate-passing**
Community listings: `seller_kind=user`, `status=active`, `visibility=public`. Catalog
intake CI (GodMode-Marketplace verify workflow + Community index gate) is what gets a
plugin onto that shelf; Bridge does not re-run Actions. It counts live public listings.

| Tier | Gate-passing listings |
|------|------------------------|
| none | 0–2 |
| Verified I | 3–4 |
| Verified II | 5–9 |
| Verified III | 10+ |

Public Community browse returns `verified_tier` (0–3) and keeps `verified_publisher`
as `1` when tier is greater than 0. Community cards show the matching badge.

Admin escape hatches on `marketplace_seller_accounts`:

- `verified_seller=1` floors the seller at Verified I (and clears freeze). Admin →
  Marketplace, or `POST /api/admin/marketplace/sellers/verified`.
- `verified_frozen=1` hides the badge even when the earned count qualifies.
  `POST /api/admin/marketplace/sellers/frozen` with `verifiedFrozen`.

Official cards do **not** use this seller-tier system.

### Buyer install pins (#177)

Official and Community **plugin** installs fail closed unless the catalog entry
sets an immutable `pluginRef` (release tag or commit sha). Optional
`pluginDigest` (commit sha) must match `git rev-parse HEAD` after checkout.
Floating refs (`main` / `master`) are rejected for those catalogs. Local folder
registration (self-host / Unofficial) stays operator-trusted and does not use
this pin gate.

### Cloud Official pin ops (#292)

On GodMode Cloud, curated Official rows live in `marketplace_official_catalog`
and are served at the public Official feed. Active `installType: "plugin"` rows
must have an immutable `pluginRef` (and preferably `pluginDigest`). Admin upsert
fail-closes on floating refs. Admin checklist:

1. `GET /api/marketplace/commerce/admin/official-catalog` and check `pinAudit`
   (empty means all active plugins are pinned).
2. Prefer `POST /api/marketplace/commerce/admin/official-catalog/sync-from-public`
   to import pinned plugin/pack rows from the free Official index while keeping
   existing Cloud `price_cents` / `listing_id` / `sort_order`.
3. Or upsert each plugin with `pluginRef` (tag or commit) and optional
   `pluginDigest` via `POST .../admin/official-catalog`.
4. Smoke: install a free Official plugin on Cloud; confirm checkout uses the pin
   (no floating `main`).
5. After a new plugin release, bump the catalog pin (tag/sha + digest) before
   promoting the row to `active`.

Intake CI does not replace install pins or runtime least privilege.
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
2. For **plugins** that need CI + pins: also PR into GodMode-Marketplace `catalog/community/index.json`.
3. Buyer: **Community** → browse community catalog + public `seller_kind=user` listings → free **Acquire** / install, or paid checkout, then acquire.
4. After a successful acquire, matching paid orders move to `delivered`.

Public browse listings: `GET /api/marketplace/listings?seller_kind=user`. Community catalog: `GET /api/marketplace/catalog/community`.

## Seller payouts (Stripe Connect)

Community sellers onboard with **Stripe Connect Express Account Links** from
Vault → Integrations → Marketplace, or the same card on Marketplace → Sell
(#316, #329). GodMode Cloud (or the hub commerce authority) creates/reuses a
Connect account and redirects to Stripe. Return/refresh URLs land back on the
page you started from: `/vault?tab=integrations` or `/marketplace?tab=seller`.

Requires `STRIPE_SECRET_KEY` (same secret used for Marketplace Checkout). Set
`WEB_PUBLIC_URL` / `WEB_ORIGIN` so return URLs match the UI origin. Local/hub
Sell UIs still proxy commerce actions to Cloud.

Paste `acct_…` remains an advanced fallback only. PayPal and crypto seller rails
are deferred (#317).


Durable buy/sell uses ObjectTypes (see [OBJECTTYPE_KERNEL.md](OBJECTTYPE_KERNEL.md)):

| ObjectType | Actions |
|---|---|
| `MarketplaceListing` | `publish`, `acquire`, `archive`, … (`price_cents`) |
| `MarketplaceOrder` | `start_checkout`, `capture_paypal`, `confirm_crypto` |
| `MarketplaceSellerAccount` | `accept_tos`, `connect_payout`, `commerce_config` |
| `CatalogInstall` | `install_entry` (gates paid Official entries) |

Payment provider webhooks and the public Official JSON feed are **protocol exceptions**, not parallel Express CRUD.

## Sell tab

**Marketplace → Sell**: accept ToS, dual-home seller Stripe Connect (Vault is the
connect home), publish via kernel `MarketplaceListing.publish` with `price_cents`,
then manage **My listings** (archive).

## Local catalogs

**Marketplace → Local** is for free local folders, `file://` catalogs, and third-party indexes (same schema as Official, typically `priceCents: 0`). It is not the Community user-listing feed.

## Related

- [MARKETPLACE_TOS.md](MARKETPLACE_TOS.md)
- [CONFIGURATION.md](CONFIGURATION.md)
- [PLUGIN_AUTHORING.md](PLUGIN_AUTHORING.md)
