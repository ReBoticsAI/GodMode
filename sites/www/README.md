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

**Open Cloud** links to `/` (AuthGate / SaaS signup).

## Production (Cloudflare Pages / www host)

Prefer pointing `www` at the same GodMode web origin and serving `/www` as the
public site (or rewrite `/` → `/www` on the Pages/hosting layer). Do **not**
reintroduce a hand-rolled parallel design system here.

Set Stripe Dashboard → Business website to the live public URL (e.g.
`https://www.example.com/www` or a rewrite to `/www`), and document it as
`BUSINESS_WEBSITE_URL`.
