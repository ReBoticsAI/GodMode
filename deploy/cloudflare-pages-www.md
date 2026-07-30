# Cloudflare Pages: marketing (`godmode.software`)

Connect the public monorepo to Cloudflare Pages so marketing ships at `/` on
`godmode.software` / `www`, then attach apex/`www` custom domains after Cloudflare
is authoritative (#200).

## GitHub project settings

| Field | Value |
|-------|--------|
| Repository | `ReBoticsAI/GodMode` |
| Production branch | `main` |
| Framework preset | None (or Vite) |
| Build command | `npm ci && npm run build:packages && npm run build -w @godmode/web` |
| Build output directory | `apps/web/dist` |
| Root directory | `/` (repo root) |
| Node version | `22` (Pages env `NODE_VERSION=22`) |

Required Pages env (Production):

```text
NODE_VERSION=22
NPM_CONFIG_IGNORE_SCRIPTS=true
VITE_MARKETING_AT_ROOT=true
```

`NPM_CONFIG_IGNORE_SCRIPTS` is required so monorepo `npm ci` does not try to
compile native addons such as `node-pty` (bridge) on the Pages Linux builder.

`build:packages` is required after ignore-scripts so workspace TypeScript packages
(`kernel`, `flow-core`, `plugin-api`, `plugin-host`) emit `dist/` before `@godmode/web`
runs `tsc -b && vite build`.

`VITE_MARKETING_AT_ROOT=true` mounts marketing at `/` (home, `/pricing`, `/terms`,
etc.) instead of `/www`. Without it, the same SPA still serves marketing under
`/www` for the app origin.

Optional Pages env:

```text
VITE_CLOUD_APP_ORIGIN=https://app.godmode.software
```

(`apps/web` defaults to that origin when unset.)

## Routing

`apps/web/public/_redirects` (copied into `dist` on build):

- `/www` and `/www/*` → `/` and `/*` (301) for old bookmarks
- `/*` → `/index.html` (200) SPA fallback for client routes

Marketing CTAs use `https://app.godmode.software` (not same-origin `/`). The
authenticated Cloud app stays on that host; this Pages project is marketing only.

## Custom domains

After nameservers are Cloudflare (`benedict` / `maleah`) and mail DKIM helpers are
DNS-only grey-cloud (#200 / #198):

1. Pages project → Custom domains → `godmode.software` and `www.godmode.software`
2. Confirm DNS records Pages creates (CNAME/ALIAS as prompted)
3. Set Stripe business website + `BUSINESS_WEBSITE_URL` to `https://godmode.software`

Until NS cutover, use the project `*.pages.dev` URL for Stripe.
