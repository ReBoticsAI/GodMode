# GodMode marketing site (public)

The public marketing / Stripe business website is built with **shadcn/ui** inside
`apps/web`, not as a separate CSS theme.

Feature copy lives in `docs/features/*.md` (also seeded into tenant platform wiki).

## Local

```bash
npm run dev -w @godmode/web
```

Open [http://127.0.0.1:5173/www](http://127.0.0.1:5173/www) (port may vary).
Local and the app origin keep marketing under `/www` so `/` stays the authenticated
app.

| Path | Page |
|------|------|
| `/www` | Home |
| `/www/features` | Features index |
| `/www/features/:slug` | Feature detail (from `docs/features`) |
| `/www/pricing` | Pricing |
| `/www/downloads` | Downloads (Stable, Nightly, Docker) |
| `/www/marketplace` | Marketplace browse |
| `/www/terms` | Terms |
| `/www/privacy` | Privacy |
| `/www/security` | Security |
| `/www/contact` | Contact |
| `/www/refund` | Refund policy |

**Open Cloud** links to your app origin (override with `VITE_CLOUD_APP_ORIGIN`;
defaults to `https://app.godmode.software` in this monorepo's web build).

## Production (Cloudflare Pages)

Connect this repository to Cloudflare Pages and auto-deploy from `main`.
On marketing hosts, the site is at `/` (`/pricing`, `/terms`, …). Legacy `/www/*`
URLs 301 to the root paths. Local and the app origin keep `/www`.

Runbook: [`deploy/cloudflare-pages-www.md`](../../deploy/cloudflare-pages-www.md).

Custom domains for apex / `www` attach after DNS cutover. Until then, use the
Pages preview hostname for Stripe business website and `BUSINESS_WEBSITE_URL`.
