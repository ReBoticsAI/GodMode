# Cloudflare Pages: marketing site

Connect this monorepo to Cloudflare Pages (or any static host) so marketing ships
at `/` on your apex / `www` host. Attach custom domains after your DNS zone is
authoritative at that provider.

## Pages project settings

| Field | Value |
|-------|--------|
| Production branch | `main` |
| Framework preset | None (or Vite) |
| Build command | `npm ci --ignore-scripts && npm run build:packages && npm run build -w @godmode/web` |
| Build output directory | `apps/web/dist` |
| Root directory | `/` (repo root) |
| Node version | `22` (Pages env `NODE_VERSION=22`) |

Required Pages env (Production and Preview):

```text
NODE_VERSION=22
NPM_CONFIG_IGNORE_SCRIPTS=true
```

Prefer baking `--ignore-scripts` into the build command **and** root `.npmrc`
(`ignore-scripts=true`) so Preview builds still work when Preview env vars are
unset. Pages Production and Preview env are separate; Pages also runs
`npm clean-install` before the configured build command, which must skip native
addon compiles.

`NPM_CONFIG_IGNORE_SCRIPTS` / `--ignore-scripts` / `.npmrc` is required so
monorepo `npm ci` does not try to compile native addons such as `node-pty`
(bridge) on the Pages Linux builder. After a local `npm ci`, rebuild bridge
natives with `npm rebuild node-pty` if the coding terminal is needed.

`build:packages` is required after ignore-scripts so workspace TypeScript packages
(`kernel`, `flow-core`, `plugin-api`, `plugin-host`) emit `dist/` before `@godmode/web`
runs `tsc -b && vite build`.

On marketing hosts, the site mounts at `/`. Optional force:

```text
VITE_MARKETING_AT_ROOT=true
```

Without a marketing host (local / app origin), marketing stays under `/www`.

Optional Pages env (Cloud app CTA target):

```text
VITE_CLOUD_APP_ORIGIN=https://app.example.com
```

## Routing

`apps/web/public/_redirects` (copied into `dist` on build):

- `/www` and `/www/*` → `/` and `/*` (301) for old bookmarks
- `/*` → `/index.html` (200) SPA fallback for client routes

Marketing CTAs should open the **authenticated app origin** (not same-origin
`/`). Keep this Pages project marketing-only.

## Custom domains

After nameservers point at your DNS/CDN provider and mail records are correct:

1. Attach apex and `www` as custom domains on the Pages project
2. Confirm the DNS records Pages (or your static host) creates
3. Set Stripe business website + `BUSINESS_WEBSITE_URL` to the public marketing URL

Until DNS cutover, use the provider preview hostname (for example `*.pages.dev`)
for Stripe business website checks.
