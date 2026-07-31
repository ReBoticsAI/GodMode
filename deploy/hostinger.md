# Hostinger VPS + Cloudflare production topology

GodMode public SaaS runs on a **Hostinger VPS** (Docker Compose) as the origin.
**Cloudflare** is the public edge (TLS, WAF, DDoS). Z440 LAN hubs are staging only
and are **not** the public DNS cutover target.

Prefer serving marketing from **Cloudflare Pages** at `/` on `godmode.software`,
or from **`apps/web` `/www`** on the same VPS app origin, so the VPS primarily
runs the authenticated app. See [`sites/www/README.md`](../sites/www/README.md)
for notes (not a separate deploy tree).

## 1. Provision Hostinger VPS

1. Create an Ubuntu 22.04+ VPS (not shared PHP hosting).
2. Install Docker Engine + Compose plugin.
3. Clone or sync this repo; use digest-pinned `GODMODE_IMAGE` from a signed release.
4. Copy `deploy/.env.production.example` → `deploy/.env.production` and set public
   `https://` URLs (`WEB_PUBLIC_URL`, `AUTH_PUBLIC_URL`, `WEB_ORIGIN`) plus a
   digest-pinned `GODMODE_IMAGE`.
5. Put `PLATFORM_DATA_DIR` on a durable volume sized for SQLite growth + local backups.
6. Start with `deploy/docker-compose.prod.yml` using `--env-file .env.production`
   so Compose can interpolate `GODMODE_IMAGE` (or `ln -sfn .env.production .env`).
   Never expose Bridge port `3847` on the public internet.
7. If you enable Cloudflare-only `ufw` (`CLOUDFLARE_ONLY=1`), publish the container
   on loopback only and terminate HTTP(S) with host nginx/Caddy. Docker's published
   `0.0.0.0` ports bypass UFW unless you do this.

## 2. Cloudflare edge (`app.godmode.software`)

Full operator checklist: [`deploy/cloudflare-app-edge.md`](cloudflare-app-edge.md)
(issue #195). Summary:

1. Orange-cloud **A/AAAA** for `app` only (not apex app routes, not `login.`).
2. SSL/TLS mode: **Full (strict)** with Origin CA (or Let’s Encrypt) on origin `:443`.
3. WAF managed rules on. **Bot Fight Mode is optional for v1** on Cloudflare Free
   (pay-first signup already gates tenants); if you enable it, verify Stripe webhooks
   and uptime checks still succeed.
4. Optional: edge rate limits on `/api/auth/*` and checkout paths.

Apex / `www` stay on Cloudflare Pages (#196). Public NS cutover is #200.

## 3. Origin firewall (`ufw`)

Prefer the script (SSH IP-restricted; never opens `:3847`):

```bash
sudo ADMIN_SSH_IP=YOUR.ADMIN.IP ./deploy/ufw-origin.sh
# Optional: Cloudflare IP ranges only for 80/443
sudo CLOUDFLARE_ONLY=1 ADMIN_SSH_IP=YOUR.ADMIN.IP ./deploy/ufw-origin.sh
```

Manual equivalent:

```bash
ufw default deny incoming
ufw allow from YOUR_ADMIN_IP to any port 22
# Prefer Cloudflare-only to 443 when practical (Cloudflare IP ranges).
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Never publish `3847` publicly. SSH should be IP-restricted.

## 4. Client IP for rate limits

Bridge trusts `CF-Connecting-IP` then `X-Forwarded-For` (see
`apps/bridge/src/services/auth/rate-limit.ts`). Production nginx includes
`deploy/cloudflare-realip.conf` (refresh via
`node deploy/scripts/refresh-cloudflare-realip.mjs`).

## 5. Cookies and CSRF

When `AUTH_PUBLIC_URL` / `WEB_PUBLIC_URL` are `https://`, session cookies are
`Secure` + `SameSite=Lax`. Lock `WEB_ORIGIN` to the exact browser origin of the
SPA. Mutating cookie-auth API calls require matching `Origin`/`Referer`.

## 6. Email

Use **Resend** (`EMAIL_PROVIDER=resend`) or generic SMTP. Do not rely on Hostinger
shared mailbox for transactional auth mail.

Required for SaaS live:

1. Create an API key in the [Resend dashboard](https://resend.com/api-keys) (starts with `re_` and is long; do not paste the `re_...` placeholder from `.env.production.example`).
2. Verify the sending domain for `EMAIL_FROM` (example: `GodMode <noreply@godmode.software>`).
3. Set on the VPS in `/opt/godmode/deploy/.env.production`:
   - `EMAIL_PROVIDER=resend`
   - `EMAIL_FROM=GodMode <noreply@your-verified-domain>`
   - `RESEND_API_KEY=<real key>`
4. Recreate the container so Bridge picks up env: `docker compose -f docker-compose.prod.yml up -d`.
5. Confirm `GET /api/health` includes `"email":{"ready":true,...}`.

If `RESEND_API_KEY` is missing or invalid, signup still creates the account but verification mail fails (logged as `Resend failed: 401`). Logged-in **Resend verification email** returns a real error once the authenticated resend path is deployed.

## 7. Backups (cron)

Keep at least one local snapshot on the VPS disk, then upload offsite:

```cron
15 3 * * * cd /opt/godmode && PLATFORM_DATA_DIR=/var/lib/godmode node scripts/backup/snapshot-platform.mjs >> /var/log/godmode-backup.log 2>&1
```

Set `BACKUP_S3_*` for S3-compatible offsite. Test restore before launch.

You can also trigger a **local-only** snapshot from **Admin → Observability →
Run local snapshot** (`POST /api/admin/marketplace/backup`). That updates
`platform_backup_meta` the same way as cron (without S3 upload).

### Restore drill (local snapshot)

1. Pick a snapshot directory under `BACKUP_LOCAL_DIR` (or `{data}/backups/<stamp>`).
2. Stop Bridge (and any process holding open SQLite handles).
3. Replace live files from the snapshot:
   - `databases/core.sqlite` → `{PLATFORM_DATA_DIR}/core.sqlite`
   - each `tenants/*.sqlite` → `{PLATFORM_DATA_DIR}/tenants/<same-name>`
4. Restore file permissions to the runtime user.
5. Start Bridge and hit `/api/health`, then Admin → Observability to confirm.
6. If you keep offsite copies, practice restoring from S3 the same way after
   downloading into a temporary directory.

Never restore over a running Bridge. Keep the pre-restore tree until health checks pass.

## 8. Observability

GodMode does **not** use external APM (no Sentry). Prefer first-party signals:

- **Admin → Observability** tab: filterable warn/error request table + last backup
  status (`platform_backup_meta`)
- Docker / Bridge **JSON request logs** on stdout (Hostinger `docker logs`)
- Warn/error rows persisted to `core.sqlite` (`platform_request_log`); API
  `GET /api/admin/observability/requests` (soft-capped at ~5k newest rows)
- External uptime check against `https://app.godmode.software/api/health` (not the raw VPS IP)

## 9. Marketing / Stripe business URL

Deploy marketing on Pages at `/` (`godmode.software`) or keep `/www` on the app
origin (shadcn in `apps/web`; see `sites/www/README.md`).
Put the live public URL in Stripe Dashboard → Business website and set
`BUSINESS_WEBSITE_URL` in operator docs. Public site must be live before enabling live
Stripe keys.

See also: [DEPLOY.md](../DEPLOY.md) launch gate, [docs/SECURITY.md](../docs/SECURITY.md).
