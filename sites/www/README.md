# GodMode marketing site (public)

The public marketing / Stripe business website is built with **shadcn/ui** inside
`apps/web`, not as a separate CSS theme.

Feature copy lives in `docs/features/*.md` (also seeded into tenant platform wiki).

## Local

```bash
npm run dev -w @godmode/web
```

Open [http://127.0.0.1:5173/www](http://127.0.0.1:5173/www) (port may vary).

| Path | Page |
|------|------|
| `/www` | Home |
| `/www/features` | Features index |
| `/www/features/:slug` | Feature detail (from `docs/features`) |
| `/www/pricing` | Pricing |
| `/www/terms` | Terms |
| `/www/privacy` | Privacy |
| `/www/security` | Security |
| `/www/contact` | Contact |
| `/www/refund` | Refund policy |

**Open Cloud** links to `https://app.godmode.software` (override with
`VITE_CLOUD_APP_ORIGIN`).

## Production (Cloudflare Pages)

Connect `ReBoticsAI/GodMode` to Cloudflare Pages and auto-deploy from `main`.
Operator runbook: [`deploy/cloudflare-pages-www.md`](../../deploy/cloudflare-pages-www.md).

Custom domains `godmode.software` / `www` attach after DNS cutover (#200). Until
then, use the Pages `*.pages.dev` hostname for Stripe business website and
`BUSINESS_WEBSITE_URL`.
