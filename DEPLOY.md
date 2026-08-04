# Deploying GodMode

GodMode ships in three deployment modes:

| Mode | `DEPLOYMENT_MODE` | Use case |
|------|-------------------|----------|
| **local** | `local` (default) | Personal workstation — single-user install |
| **hub** | `hub` | Multi-tenant SaaS (your VPS only) |
| **client** | `client` | Personal Docker; marketplace proxies to hub |

## Local (recommended for personal use)

**Desktop download (non-technical):** install the signed Electron app from
[GitHub Releases](https://github.com/ReBoticsAI/GodMode/releases) — Windows NSIS,
macOS DMG, or Linux AppImage/`.deb`. See [docs/RELEASES.md](docs/RELEASES.md).

**Developer clone** (no Docker required):

```powershell
npm install
copy apps\bridge\.env.example apps\bridge\.env
npm run dev
```

Open http://localhost:5173 and sign up with email and password.

## Hub (production SaaS)

Official paid multi-tenant hub uses `INSTALLATION_SURFACE=saas` and a Stripe
paywall: **choose plan → Checkout → create account** (no invite codes). Local and
desktop installs stay first-class; Cloud is the easier browser onboarding path and
revenue product.

### Ready doctrine (project board)

[GodMode Roadmap](https://github.com/users/ReBoticsAI/projects/1) **Ready** prioritizes:

1. **P0** - Hostinger SaaS live (public DNS gate below)
2. **P1** - Dogfood GodMode-from-GodMode (plugins + Core), then marketplace trust
3. Core Control Center depth and plugin-backlog stay in **Backlog** until live + dogfood clear

Do not treat Core epic checklist items as jump-the-queue ahead of launch.

Self-hosted family/team hubs use `private_hub` and skip the paywall.

1. Copy `deploy/.env.production.example` → `deploy/.env.production` and set:
   - `WEB_PUBLIC_URL`, `AUTH_PUBLIC_URL`, `WEB_ORIGIN` to your public domain
   - `AUTH_SESSION_SECRET` (32+ random bytes)
   - `INITIAL_ADMINS` for your operator account (not paywalled)
   - `STRIPE_SECRET_KEY`, `STRIPE_SAAS_PRICE_MONTHLY`, `STRIPE_SAAS_PRICE_YEARLY`,
     `STRIPE_WEBHOOK_SECRET` (optional legacy `STRIPE_SAAS_PRICE_ID` fallback)
   - Keep `AUTH_ALLOW_SIGNUP=false` — SaaS signup is unlocked only after Checkout
2. Resolve the desired stable release to its signed immutable GHCR digest, put it
   in `deploy/.env.production` as `GODMODE_IMAGE`, then pull and run. Compose
   interpolates `GODMODE_IMAGE` from `--env-file` (or a `deploy/.env` symlink);
   `env_file:` alone only injects vars into the container:

```bash
cd deploy
# optional convenience: ln -sfn .env.production .env
PRIOR="$GODMODE_IMAGE"   # capture before changing the pin
docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
# keep only current + previous digest (avoids disk bloat from frequent pins)
./scripts/prune-old-images.sh --previous "$PRIOR"
```

See [deploy/hostinger.md](deploy/hostinger.md) §8 for Hostinger VPS notes.

3. Point DNS at the VPS. Terminate TLS at your reverse proxy or extend `nginx.conf` with certbot.
   Behind Cloudflare-only `ufw`, bind the container to loopback (for example
   `127.0.0.1:8080:80`) and put host nginx on `:80`/`:443` so Docker does not
   bypass the firewall.
4. Stripe Dashboard → Webhooks → `https://<domain>/api/saas/stripe/webhook` with:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. In Stripe → Settings → Billing → Customer portal, enable the portal so
   Settings → **Manage subscription** can deep-link customers to cancel/update
   payment methods.
6. Set monthly/yearly Price IDs (`STRIPE_SAAS_PRICE_MONTHLY` /
   `STRIPE_SAAS_PRICE_YEARLY`) for the paywall plan picker.

Paid customers manage billing from **Settings → Vault → GodMode Cloud** (Stripe Customer
Portal). Platform admins see customers under **Admin → SaaS** (plan, status,
last seen, Stripe link, disable access). `INITIAL_ADMINS` remain paywall-exempt
and are not blocked when a subscription lapses.

**Security gate:** Do not expose a hub publicly until `AUTH_ALLOW_ANONYMOUS=false`,
SaaS paywall or invite-only signup, and CORS locked to `WEB_ORIGIN`.

### Test SaaS beside a private hub (e.g. Z440)

Run a second compose project so family data stays on `private_hub`:

```bash
cp deploy/.env.saas-staging.example deploy/.env.saas-staging
# edit image digest (or omit to build from tree), secrets, Stripe test keys, SAAS_HOST_PORT=9080
cd deploy
docker compose -p godmode-saas -f docker-compose.saas-staging.yml --env-file .env.saas-staging up -d --build
# after a CI image digest is set in GODMODE_IMAGE, use pull instead of --build
stripe listen --forward-to http://127.0.0.1:9080/api/saas/stripe/webhook
```

Open `http://<host>:9080`, sign in as `INITIAL_ADMINS`, then in a private window:
Sign up → Continue to payment → return → create account.

Prefer a CI image over a local build: after merge to `main`, **Publish SaaS image**
pushes `ghcr.io/<org>/godmode:saas-staging` (and `sha-<commit>`). Set
`GODMODE_IMAGE` to that digest in `.env.saas-staging` and `up -d` without `--build`.
You can also run the workflow manually from Actions without waiting for nightly.

### Hub smoke test

After the container is up, verify core endpoints:

```powershell
.\scripts\hub-smoke-test.ps1 -BaseUrl http://127.0.0.1:3847
```

On VPS staging, point `-BaseUrl` at your internal Bridge URL (nginx → `127.0.0.1:3847`). Full launch validation still requires password sign-in, new-tenant bootstrap, and marketplace browse in the browser.

**Default landing:** signed-in users land on `/home` (welcome hub).

## Client (personal Docker)

1. Copy `deploy/.env.client.example` → `deploy/.env.client`.
2. Set `CLOUD_HUB_URL` to the **official** hub domain (marketplace authority).
3. Set `GODMODE_IMAGE` to the verified immutable release digest and run:

```bash
cd deploy
docker compose -f docker-compose.client.yml pull
docker compose -f docker-compose.client.yml up -d
```

Open http://localhost:8080. Sign in with email and password. Workspace data stays on your machine; credits and marketplace listings come from the hub.

## Image and native addons

The production image ([`deploy/Dockerfile`](deploy/Dockerfile)) is
`node:22-bookworm-slim` (**glibc**), not Alpine. Core `duckdb` (platform
analytics) and `better-sqlite3` ship as glibc natives built in-image.

Marketplace Local plugins load **in-process** in that container. If a plugin
depends on native modules (for example its own DuckDB), install or rebuild
those deps **against this image** (CI job or
`docker run --rm -v <plugin>:/plugin <godmode-image> npm ci`). Do not treat
host `npm install` on a different libc as the source of truth for Docker hubs.

### Plugin web CSP

Production nginx sets a strict `Content-Security-Policy`. Plugin UI bundles
resolve shared host modules (`react`, `@godmode/web-host`, …) through an
**inline import map** in `index.html`. CSP requires that map’s body hash:

- Vite writes `dist/.importmap-csp-hash` at build time
- `deploy/docker-entrypoint.sh` injects `'sha256-…'` into nginx `script-src`

**Contract for plugin authors:** browser bundles must run without
`'unsafe-eval'`. Do not call `ajv.compile`, `new Function`, or `eval` at
runtime in web code. Precompile validators (AJV standalone) or validate on
the bridge. First-party example: Sierra `playbook-schema` codegen.

## Data persistence

Both compose files mount `PLATFORM_DATA_DIR=/data` (SQLite tenants, core DB, tenant sandboxes).

That volume also contains native ObjectType tables, durable operation/audit
state (including leases, retries, cancellation, idempotency, and recovery),
event-consumer receipts, cross-database acquisition saga/outbox rows, and
Intelligence-authored plugins. Back up the entire platform data directory before
image upgrades, plugin lifecycle changes, or ObjectType schema changes. The
release updater coordinates SQLite backups for `core.sqlite` and every tenant
database, captures tenant workspaces and plugin locks, verifies integrity and
hashes, and stores the snapshot outside the active data volume before
replacement.

Native ObjectType evolution is additive only. Plugin uninstall removes runtime
visibility but retains native tables and Records, so uninstall is not an erasure
or space-reclamation operation. Verify `/api/health`, ObjectType discovery,
plugin navigation, a representative Record action, async recovery, and the
strict zero-debt audit after deployment; see
[docs/VERIFICATION.md](docs/VERIFICATION.md).

Startup reconciles installed-plugin ObjectTypes and seeds before serving tenant
traffic, recovers replay-safe leased operations, and starts tenant durable-event
relays. Include `/api/kernel/capabilities` in the post-deploy smoke check. On the
Z440, also record the exact 40-character source revision and prove the running
container's immutable image ID equals the image built from it using the commands
in [docs/VERIFICATION.md](docs/VERIFICATION.md#z440-revision-and-image-identity).

## Intelligence on hub

New tenants get Intelligence with `backend=provider` (OpenAI-compatible). Users add API keys in **Vault → Inference** and configure the provider in **Agents → Pipeline**.

### Hub + local GGUF on the host GPU

The production image does not run CUDA. Run `llama-server` on the host and attach from the container:

```bash
cd deploy
docker compose -f docker-compose.hub-external-llm.yml pull
docker compose -f docker-compose.hub-external-llm.yml up -d
```

Requires `LLAMA_EXTERNAL=true`, a models bind-mount, and `host.docker.internal` → host gateway. See [docs/LOCAL_LLM.md](docs/LOCAL_LLM.md) for a recommended Gemma 4 26B / 16 GB GPU profile.

Optional: mount `./plugins:/plugins` and install via **Marketplace → Unofficial** using a container path such as `/plugins/my-plugin`. See [docs/MARKETPLACE.md](docs/MARKETPLACE.md#docker-hub-notes).

## Releases and updates

Nightly and stable artifacts are built from one validated commit. Production
compose files consume only digest-pinned images; the source-build path lives in
`deploy/docker-compose.dev.yml` and is not an update channel. Administrators can
review signed releases under **Admin → Updates** or apply them with the
host-side helper without granting Bridge access to Docker or the OS service
manager. See [docs/RELEASES.md](docs/RELEASES.md) for signing, snapshots,
readiness, rollback, bare-metal bundles, and offline updates.

## Hardware-bound marketplace plugins

Some domain packs require a **local connector** on the user's machine. See `apps/connector/README.md`. The hub/client Docker image runs the platform core only.

## Hostinger VPS checklist

Full topology: [deploy/hostinger.md](deploy/hostinger.md).

- Ubuntu 22.04+, Docker + Compose plugin (not shared PHP hosting)
- Cloudflare orange-cloud for `app.godmode.software` → VPS IP; SSL **Full (strict)**; WAF enabled ([deploy/cloudflare-app-edge.md](deploy/cloudflare-app-edge.md))
- Firewall: SSH IP-restricted; 80/443 only; **never** publish Bridge `3847` (`deploy/ufw-origin.sh`)
- `deploy/.env.production` with real secrets (never commit)
- Digest-pinned `GODMODE_IMAGE`; durable `PLATFORM_DATA_DIR` volume
- Cron backups via `deploy/scripts/run-platform-backup.sh` (Docker volume +
  `scripts/backup/snapshot-platform.mjs`, SQLite + DuckDB timeseries; brief
  Bridge stop/start so DuckDB is not locked; Admin in-process snapshot for
  zero downtime); offsite via operator PC download of the nightly stamp
  (`deploy/scripts/pull-platform-backup.sh`), optional `BACKUP_S3_*` later
  ([deploy/hostinger.md](deploy/hostinger.md) §7)
- Optional: external Postgres later for `core.sqlite` at scale (not required for launch)

## Public marketing site (Stripe business website)

Deploy the public marketing site from **`apps/web`** (shadcn) before enabling
**live** Stripe keys. Prefer **Cloudflare Pages** connected to GitHub (`main`) so
marketing is at `/` on `godmode.software`
(see [`deploy/cloudflare-pages-www.md`](deploy/cloudflare-pages-www.md)). On the
app origin, marketing remains under `/www`. Operator notes:
[`sites/www/README.md`](sites/www/README.md) (documentation only; not a separate
deploy tree). Set the live URL in Stripe Dashboard → Business website and document
it as `BUSINESS_WEBSITE_URL` for operators.

The public site must be viewable without GodMode auth (home, pricing, Terms,
Privacy, security summary, contact, refund).

## Public DNS launch gate

**Do not** point public DNS at SaaS until all are true:

1. Marketing site live and Stripe business URL accepted
2. Email verify + password reset working with production mail (`EMAIL_PROVIDER`)
3. Platform admin MFA enrolled and enforced on SaaS
4. Cloudflare → Hostinger Full (strict), origin security headers, HTTPS cookies, firewall locked
5. Durable rate limits + Hostinger cron backups + tested offsite restore
   (operator PC download of a nightly stamp + integrity verify; S3/R2 optional)
6. SaaS coding on by default (#178; opt out with `PLATFORM_SAAS_ALLOW_CODE_ACCESS=false`); Local plugin path registration blocked by default
7. Live Stripe webhooks + Customer Portal verified on the Cloudflare hostname
8. [docs/SECURITY.md](docs/SECURITY.md) / this file / [deploy/hostinger.md](deploy/hostinger.md) checklist signed off

Environments during hardening: Z440 family `:8080` + LAN SaaS `:9080` for iteration;
**Hostinger** is the public production target once the gate passes.
