# Hostinger VPS + Cloudflare production topology

GodMode public SaaS runs on a **Hostinger VPS** (Docker Compose) as the origin.
**Cloudflare** is the public edge (TLS, WAF, DDoS). Z440 LAN hubs are staging only
and are **not** the public DNS cutover target.

Prefer hosting the marketing site (`sites/www`) on **Cloudflare Pages** so the VPS
only runs the authenticated app origin.

## 1. Provision Hostinger VPS

1. Create an Ubuntu 22.04+ VPS (not shared PHP hosting).
2. Install Docker Engine + Compose plugin.
3. Clone or sync this repo; use digest-pinned `GODMODE_IMAGE` from a signed release.
4. Copy `deploy/.env.production.example` → `deploy/.env.production` and set public
   `https://` URLs (`WEB_PUBLIC_URL`, `AUTH_PUBLIC_URL`, `WEB_ORIGIN`).
5. Put `PLATFORM_DATA_DIR` on a durable volume sized for SQLite growth + local backups.
6. Start with `deploy/docker-compose.prod.yml` (or SaaS compose) — never expose
   Bridge port `3847` on the public internet.

## 2. Cloudflare edge

1. Point the app hostname A/AAAA (orange cloud) at the Hostinger VPS public IP.
2. SSL/TLS mode: **Full (strict)**.
3. Enable WAF managed rules and Bot Fight / equivalent.
4. Optional: edge rate limits on `/api/auth/*` and checkout paths.
5. Install a **Cloudflare Origin CA** certificate (or Let’s Encrypt) on the Hostinger
   nginx/container so Full (strict) works.

## 3. Origin firewall (`ufw`)

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
`apps/bridge/src/services/auth/rate-limit.ts`). Configure nginx `real_ip` from
Cloudflare ranges (commented example in `deploy/nginx.conf`).

## 5. Cookies and CSRF

When `AUTH_PUBLIC_URL` / `WEB_PUBLIC_URL` are `https://`, session cookies are
`Secure` + `SameSite=Lax`. Lock `WEB_ORIGIN` to the exact browser origin of the
SPA. Mutating cookie-auth API calls require matching `Origin`/`Referer`.

## 6. Email

Use **Resend** (`EMAIL_PROVIDER=resend`) or generic SMTP — do not rely on Hostinger
shared mailbox for transactional auth mail.

## 7. Backups (cron)

Keep at least one local snapshot on the VPS disk, then upload offsite:

```cron
15 3 * * * cd /opt/godmode && PLATFORM_DATA_DIR=/var/lib/godmode node scripts/backup/snapshot-platform.mjs >> /var/log/godmode-backup.log 2>&1
```

Set `BACKUP_S3_*` for S3-compatible offsite. Test restore before launch.

## 8. Observability

GodMode does **not** use external APM (no Sentry). Prefer first-party signals:

- Docker / Bridge **JSON request logs** on stdout (Hostinger `docker logs`)
- Warn/error rows persisted to `core.sqlite` (`platform_request_log`); Admin API
  `GET /api/admin/observability/requests`
- External uptime check against `https://<cloudflare-host>/api/health` (not the raw VPS IP)

## 9. Marketing / Stripe business URL

Deploy the marketing routes at `/www` (shadcn in `apps/web`; see `sites/www/README.md`).
Put the live public URL in Stripe Dashboard → Business website and set
`BUSINESS_WEBSITE_URL` in operator docs. Public site must be live before enabling live
Stripe keys.

See also: [DEPLOY.md](../DEPLOY.md) launch gate, [docs/SECURITY.md](../docs/SECURITY.md).
