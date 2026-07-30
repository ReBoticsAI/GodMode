# Cloudflare Pages: marketing (`godmode.software`)

Connect the public monorepo to Cloudflare Pages so `/www` marketing ships on
`*.pages.dev`, then attach apex/`www` after Cloudflare is authoritative (#200).

## GitHub project settings

| Field | Value |
|-------|--------|
| Repository | `ReBoticsAI/GodMode` |
| Production branch | `main` |
| Framework preset | None (or Vite) |
| Build command | `npm ci && npm run build -w @godmode/web` |
| Build output directory | `apps/web/dist` |
| Root directory | `/` (repo root) |
| Node version | `22` (Pages env `NODE_VERSION=22`) |

Optional Pages env:

```text
VITE_CLOUD_APP_ORIGIN=https://app.godmode.software
```

(`apps/web` defaults to that origin when unset.)

## Routing

`apps/web/public/_redirects` (copied into `dist` on build):

- `/` → `/www` (302) so the marketing host home is public site content
- `/*` → `/index.html` (200) SPA fallback for client routes

Marketing CTAs use `https://app.godmode.software` (not same-origin `/`).

## Custom domains

After nameservers are Cloudflare (`benedict` / `maleah`) and mail DKIM helpers are
DNS-only grey-cloud (#200 / #198):

1. Pages project → Custom domains → `godmode.software` and `www.godmode.software`
2. Confirm DNS records Pages creates (CNAME/ALIAS as prompted)
3. Set Stripe business website + `BUSINESS_WEBSITE_URL` to `https://godmode.software`

Until NS cutover, use the project `*.pages.dev` URL for Stripe.
