# Hostinger VPS + Cloudflare production topology

GodMode public SaaS runs on a **Hostinger VPS** (Docker Compose) as the origin.
**Cloudflare** is the public edge (TLS, WAF, DDoS). Z440 LAN hubs are staging only
and are **not** the public DNS cutover target.

## Production gate (merge to main)

Two different deploy shapes (do not conflate them):

| Surface | Host | Who builds | Who serves |
|---------|------|------------|------------|
| Marketing `godmode.software` / `www` | Cloudflare Pages | Cloudflare builders | Cloudflare edge |
| Authenticated SaaS `app.godmode.software` | Hostinger Docker | Free GitHub-hosted runners → GHCR | Hostinger + CF edge proxy |

Marketing never needs a VPS Actions runner. See
[`cloudflare-pages-www.md`](cloudflare-pages-www.md) and
[`cloudflare-app-edge.md`](cloudflare-app-edge.md).

**Normal SaaS cutover is automated.** A green merge to `main` that triggers
**Publish SaaS image** builds/signs a GHCR digest on **ubuntu-latest** (free OSS
minutes). Then the VPS self-hosted runner (`self-hosted,linux,godmode-saas`) runs
[`scripts/update/godmode-saas-pin.sh`](../scripts/update/godmode-saas-pin.sh):
rewrite only `GODMODE_IMAGE=…@sha256:…` in `deploy/.env.production`, compose
pull/up, health check. Secrets stay on the VPS; the job must never dump the env
file. After health OK, Waiting Deploy project items contained in that commit move
to Done (soft-fail via `scripts/update/move-waiting-deploy-to-done.mjs`).

The on-box runner is **pin-only**: idle most of the time. It does not continuously
pull images. Image build stays on GitHub-hosted runners. Bandwidth spikes only when
you actually ship a new digest (expected).

**Anti-loop safeguards** (already in
[`.github/workflows/publish-saas-image.yml`](../.github/workflows/publish-saas-image.yml)):

- Concurrency group `publish-saas-image-${{ github.ref }}` with
  `cancel-in-progress: true` (one in-flight publish per branch)
- Path filters so docs-only merges do not always rebuild/deploy
- `workflow_dispatch` does **not** deploy unless `deploy_hostinger=true`
- Exactly **one** runner with labels `self-hosted`, `linux`, `godmode-saas`
  (do not register extra runners for other workflows)

**Ops precondition:** register that Hostinger Actions runner so it can reach
`/opt/godmode` and Docker. Without it, `deploy-hostinger` queues until a runner
appears. Install steps: [§ Self-hosted `godmode-saas` runner](#self-hosted-godmode-saas-runner).

**Escape hatches:** Stable-tag promote remains
[`.github/workflows/promote-saas.yml`](../.github/workflows/promote-saas.yml).
Manual/emergency pin: Cursor skill `/deploygodmodecloud` or run
`godmode-saas-pin.sh` on the box.

Prefer serving marketing from **Cloudflare Pages** at `/` on `godmode.software`,
so the VPS primarily runs the authenticated app. See
[`sites/www/README.md`](../sites/www/README.md).

## Self-hosted `godmode-saas` runner

Install **one** GitHub Actions runner on the Hostinger VPS. It only picks up
`deploy-hostinger` from **Publish SaaS image** (labels must match exactly).

### Install (Ubuntu x86_64)

Run as root on the VPS (replace `REGISTRATION_TOKEN` with a short-lived token from
GitHub → Settings → Actions → Runners → New self-hosted runner, or
`gh api -X POST repos/ReBoticsAI/GodMode/actions/runners/registration-token`).

```bash
set -euo pipefail
useradd --system --create-home --home-dir /opt/actions-runner --shell /bin/bash \
  github-runner || true
usermod -aG docker github-runner
mkdir -p /opt/actions-runner
cd /opt/actions-runner
# Pin a release from https://github.com/actions/runner/releases
RUNNER_VERSION=2.336.0
curl -fsSL -o actions-runner-linux-x64.tar.gz \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
tar xzf actions-runner-linux-x64.tar.gz
rm -f actions-runner-linux-x64.tar.gz
chown -R github-runner:github-runner /opt/actions-runner
sudo -u github-runner ./config.sh --unattended \
  --url https://github.com/ReBoticsAI/GodMode \
  --token REGISTRATION_TOKEN \
  --name godmode-saas \
  --labels self-hosted,linux,godmode-saas \
  --work _work \
  --replace
./svc.sh install github-runner
./svc.sh start
./svc.sh status
```

Verify from an operator machine:

```bash
gh api repos/ReBoticsAI/GodMode/actions/runners \
  --jq '.runners[]|{name,status,labels:[.labels[].name]}'
```

Expect one runner `godmode-saas` with `status: online` and labels including
`godmode-saas`.

Grant the service user write access to the pin targets without making secrets
world-readable (on the VPS, after install):

```bash
setfacl -m u:github-runner:rwx /opt/godmode /opt/godmode/deploy
setfacl -R -m u:github-runner:rwX /opt/godmode/.git
setfacl -m u:github-runner:rw /opt/godmode/deploy/.env.production
sudo -u github-runner git config --global --add safe.directory /opt/godmode
```

`github-runner` must also be in the `docker` group (included in the install steps
above).

### Re-register

If the runner vanishes from GitHub or stays offline:

```bash
cd /opt/actions-runner
./svc.sh stop || true
sudo -u github-runner ./config.sh remove --token REGISTRATION_TOKEN || true
# then re-run config.sh + svc.sh install/start as above with a fresh token
```

Do **not** register additional self-hosted runners on this host for unrelated
workflows. Image build/validate stay on `ubuntu-latest`.

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

### Clean host checkout (recommended layout)

Mental model:

- **App**: digest-pinned GHCR image via Compose (`GODMODE_IMAGE` in `.env.production`)
- **Data**: Docker volume `deploy_godmode-data` (never delete)
- **Host**: thin git tree at `/opt/godmode` matching `origin/main`, plus local-only secrets

Keep these **on the VPS only** (gitignored; never `git add`, never push):

| Path | Purpose |
|------|---------|
| `deploy/.env.production` | Secrets + `GODMODE_IMAGE` pin |
| `deploy/.env` | Optional symlink to `.env.production` |
| `deploy/docker-compose.override.yml` | Machine port bind (see example below) |

Do **not** fork tracked `deploy/docker-compose.prod.yml` for `8080` or loopback.
Copy the example override instead:

```bash
cp /opt/godmode/deploy/docker-compose.hostinger-override.example.yml \
  /opt/godmode/deploy/docker-compose.override.yml
```

Bring the stack up (override required so host nginx can reach `127.0.0.1:8080`):

```bash
cd /opt/godmode/deploy
docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f docker-compose.override.yml up -d
```

Cron paths stay under `/opt/godmode/deploy/scripts/` (see §7). Backup/prune scripts
auto-include `docker-compose.override.yml` when that file exists.

#### Refresh tracked files from `main` without losing secrets

```bash
# 1) Backup local-only files outside the repo (mode 600/700)
mkdir -p /root/godmode-env-backup && chmod 700 /root/godmode-env-backup
cp -a /opt/godmode/deploy/.env.production /root/godmode-env-backup/
cp -a /opt/godmode/deploy/docker-compose.override.yml /root/godmode-env-backup/ 2>/dev/null || true

# 2) Hard-reset tracked tree to origin/main (does not delete gitignored env)
cd /opt/godmode
git fetch origin main
git reset --hard origin/main

# 3) Restore override if needed, then recreate (volume name unchanged)
cp -a /root/godmode-env-backup/docker-compose.override.yml \
  /opt/godmode/deploy/docker-compose.override.yml
cd /opt/godmode/deploy
docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f docker-compose.override.yml up -d
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/api/health
```

Delete editor junk (`.env.production.bak*`, `*.bak`, `*~`) from the deploy dir;
keep a single backup under `/root/godmode-env-backup/` if you need history.

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

Prod Compose mounts durable data at container `/data` (Docker volume
`deploy_godmode-data` on Hostinger). The host has no Node runtime; run snapshots
through the digest-pinned `GODMODE_IMAGE` instead of bare `node` on the VPS.

### Install nightly cron

```bash
chmod +x /opt/godmode/deploy/scripts/*.sh
sudo /opt/godmode/deploy/scripts/install-backup-cron.sh
# optional: run once now
sudo /opt/godmode/deploy/scripts/run-platform-backup.sh
```

Default schedule: `15 3 * * *` (03:15 UTC) → `/var/log/godmode-backup.log`.

The runner loads `deploy/.env.production`, mounts the `godmode-data` volume at
`/data`, and executes `scripts/backup/snapshot-platform.mjs` (from the image when
present, otherwise host-mounted from the repo checkout). The snapshot covers
SQLite (core + tenants) and DuckDB platform analytics under `timeseries/`.

DuckDB holds an exclusive process lock while Bridge is running, so the cron
runner briefly `compose stop godmode` around the one-shot snapshot container,
then `start` again (trap-safe). Set `GODMODE_BACKUP_SKIP_STOP=1` only when
Bridge is already down. For zero-downtime snapshots, use **Admin → Observability →
Run local snapshot** (`POST /api/admin/marketplace/backup`), which copies
DuckDB in-process.

### Offsite (operator PC download)

Primary offsite for launch: copy the latest **nightly snapshot stamp** from the
VPS onto a machine you control (not live `core.sqlite` / `tenants/` /
`timeseries/` while Bridge writers are open). Cron stays on the VPS; offsite
means copies leave the VPS.

**Preferred (no SSH):** signed-in platform admin with MFA → **Admin →
Observability** → **Download latest backup** (or pick a stamp / **Snapshot then
download**). That hits `GET /api/admin/marketplace/backup/download` and streams
a closed stamp as `godmode-backup-<stamp>.tar.gz` (SQLite + DuckDB timeseries +
manifest). Rate-limited; audited in `platform_action_log`. Tenant users cannot
use this path (contrast tenant SQLite self-serve, #235).

**SSH fallback** when the Admin UI is unavailable:

Each stamp includes:

- SQLite: `databases/core.sqlite` + `tenants/*.sqlite`
- DuckDB: `timeseries/tenant=*/analytics.duckdb` (platform analytics; consistent
  `COPY FROM DATABASE` snapshot, not a live file copy)

Tenant self-serve download (#235): Cloud **Settings → Workspace data → Download my
database** (`GET /api/tenant/database/download`) streams an owner-only SQLite
snapshot of that tenant's workspace file. Rate-limited; audited as
`tenant.database.download`. SQLite-only for that tenant (not DuckDB, not
`core.sqlite`, not other tenants). Operator DR above is SQLite **and** DuckDB for
the whole platform.

Host path for stamps:

`/var/lib/docker/volumes/deploy_godmode-data/_data/backups/<stamp>/`

```bash
# helper (Git Bash / macOS / Linux)
GODMODE_VPS=root@YOUR.VPS.IP DEST="$HOME/GodMode-backups" \
  ./deploy/scripts/pull-platform-backup.sh

# or one-shot scp of the latest stamp
STAMP=2026-08-01T00-14-00-338Z   # ls the backups dir on the VPS for latest
scp -r "root@YOUR.VPS.IP:/var/lib/docker/volumes/deploy_godmode-data/_data/backups/$STAMP" \
  "$HOME/GodMode-backups/"
```

Integrity on the offsite copy:

1. SHA-256 the local `databases/core.sqlite`, each `tenants/*.sqlite`, each
   `timeseries/tenant=*/analytics.duckdb`, and `manifest.json`; confirm they
   match the same paths on the VPS stamp.
2. On the VPS, run the verify-only drill for that stamp (SQLite
   `integrity_check` plus DuckDB open/`SELECT 1` on a scratch copy; does not
   stop prod):

```bash
sudo /opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only --stamp "$STAMP"
```

Matching checksums plus a green integrity drill means the PC tree is a verified
offsite copy of that stamp. Treat the files as sensitive (tenant data).

You can also trigger a **local-only** zero-downtime snapshot from **Admin →
Observability → Run local snapshot** (`POST /api/admin/marketplace/backup`).
That uses in-process DuckDB COPY (no Bridge stop) and updates
`platform_backup_meta` the same way as cron (without uploading anywhere).

### Optional later: `BACKUP_S3_*` / Hostinger paid backups

S3-compatible upload (Cloudflare R2, etc.) and Hostinger paid backups are
optional follow-ups. They are not required for the PC-download offsite path.

```bash
BACKUP_LOCAL_DIR=/data/backups
BACKUP_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=godmode-backups
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_S3_PREFIX=godmode/
```

If configured, the cron runner passes `BACKUP_S3_*` into a one-shot container.
Bridge Admin local snapshot does not upload to S3.

### Restore drill

Prefer the scripted verify-only drill (integrity check on a scratch copy; does
not stop prod):

```bash
sudo /opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only
# only if BACKUP_S3_* is configured:
sudo /opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only --from-s3
```

Manual / apply cutover (stops Bridge; keep the pre-restore tree):

1. Pick a snapshot under the volume backups dir
   (`/var/lib/docker/volumes/deploy_godmode-data/_data/backups/<stamp>`), or use
   a PC-downloaded stamp you have verified.
2. Stop Bridge: `docker compose -f docker-compose.prod.yml stop godmode`.
3. Replace live files from the snapshot:
   - `databases/core.sqlite` → volume `core.sqlite` (remove `-wal`/`-shm`)
   - each `tenants/*.sqlite` → volume `tenants/<same-name>`
   - each `timeseries/tenant=*/analytics.duckdb` → volume
     `timeseries/tenant=*/analytics.duckdb`
4. Start Bridge and hit `/api/health`, then Admin → Observability.

Never restore over a running Bridge. Keep the pre-restore tree until health checks pass.
Or use `restore-platform-drill.sh --apply --stamp <stamp>` only when intentionally
practicing a full cutover.

## 8. Redeploy image retention

Digest-pinned redeploys leave unused `ghcr.io/reboticsai/godmode` layers on the
host. Keep only the **running** image and the **immediate previous** (rollback):

```bash
cd /opt/godmode/deploy
# 1) note the prior pin before editing .env.production
PRIOR="$GODMODE_IMAGE"   # or: grep '^GODMODE_IMAGE=' .env.production
# 2) set GODMODE_IMAGE to the new digest, then:
docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f docker-compose.override.yml pull
docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f docker-compose.override.yml up -d
# 3) prune older digests (current + previous only)
./scripts/prune-old-images.sh --previous "$PRIOR"
```

Without `--previous`, the script keeps the newest non-running local digest for
that repo automatically. `scripts/update/godmode-update.sh` (promote workflow)
calls the same prune after a successful readiness check.

One-off cleanup of leftover digests (same policy):

```bash
/opt/godmode/deploy/scripts/prune-old-images.sh
```

## 9. Observability

GodMode does **not** use external APM (no Sentry). Prefer first-party signals:

- **Admin → Observability** tab: filterable warn/error request table + last backup
  status (`platform_backup_meta`)
- Docker / Bridge **JSON request logs** on stdout (Hostinger `docker logs`)
- Warn/error rows persisted to `core.sqlite` (`platform_request_log`); API
  `GET /api/admin/observability/requests` (soft-capped at ~5k newest rows)
- External uptime check against `https://app.godmode.software/api/health` (not the raw VPS IP)

## 10. Marketing / Stripe business URL

Deploy marketing on Pages at `/` (`godmode.software`) or keep `/www` on the app
origin (shadcn in `apps/web`; see `sites/www/README.md`).
Put the live public URL in Stripe Dashboard → Business website and set
`BUSINESS_WEBSITE_URL` in operator docs. Public site must be live before enabling live
Stripe keys.

## 11. Layer 4 ephemeral builds (coding)

SaaS coding Layers 1–3 run inside Bridge (hub defaults + bubblewrap). Layer 4
delegates allowlisted npm builds to a **host build supervisor** so Bridge never
mounts `docker.sock`. See [`deploy/build-supervisor/README.md`](build-supervisor/README.md)
and [`docs/SECURITY.md`](../docs/SECURITY.md).

### Checklist (Hostinger prod)

1. Ensure `/opt/godmode` tracks `origin/main` (refresh per §1; keep `.env.production`
   and `docker-compose.override.yml` on the VPS only).
2. Generate a SaaS-only bearer (never commit; never paste into GitHub issues):

   ```bash
   openssl rand -hex 32
   ```

3. In `/opt/godmode/deploy/.env.production` set:

   ```bash
   CODING_BUILD_MODE=ephemeral
   CODING_BUILD_SUPERVISOR_URL=http://host.docker.internal:8792
   CODING_BUILD_SUPERVISOR_TOKEN=<generated token>
   CODING_BUILD_NET=allowlist
   CODING_BUILD_EGRESS_HOSTS=registry.npmjs.org,github.com,api.github.com
   ```

   Prefer a token bound only to this SaaS data volume (do not share with a private hub).

4. Start the supervisor against the Compose data volume (creates
   `tenant-workspaces/` if missing; does **not** delete `deploy_godmode-data`):

   ```bash
   chmod +x /opt/godmode/deploy/scripts/start-build-supervisor.sh \
     /opt/godmode/deploy/scripts/lock-build-supervisor-wan.sh
   sudo /opt/godmode/deploy/scripts/start-build-supervisor.sh
   ```

5. Lock WAN access to supervisor ports. Docker publishes `8792`/`8793` on
   `0.0.0.0` so Linux Bridge can use `host.docker.internal`; UFW alone does not
   cover Docker-published ports:

   ```bash
   sudo /opt/godmode/deploy/scripts/lock-build-supervisor-wan.sh
   # optional persist after reboot:
   sudo apt-get install -y iptables-persistent
   sudo netfilter-persistent save
   ```

6. Recreate Bridge so it picks up `CODING_BUILD_*` from `.env.production`:

   ```bash
   cd /opt/godmode/deploy
   docker compose --env-file .env.production \
     -f docker-compose.prod.yml -f docker-compose.override.yml up -d
   ```

7. Verify (no secrets in output):

   ```bash
   curl -fsS http://127.0.0.1:8792/health
   # From Bridge network path:
   docker compose --env-file .env.production \
     -f docker-compose.prod.yml -f docker-compose.override.yml exec godmode \
     wget -qO- http://host.docker.internal:8792/health
   # Admin UI: Admin → Authority → Build mode ephemeral + Supervisor reachable
   # API: GET /api/admin/authority/coding-status (platform admin + MFA)
   ```

8. Smoke fail-closed: with token removed from Bridge env (or wrong token),
   `run_ephemeral_build` must refuse. Missing `CODING_BUILD_MODE=ephemeral` also
   fails closed. In-process `build_plugin` (esbuild) stays available and is
   unchanged by Layer 4.

Do **not** mount `/var/run/docker.sock` into the `godmode` service. Residual
shared-host isolation is tracked in #172.

See also: [DEPLOY.md](../DEPLOY.md) launch gate, [docs/SECURITY.md](../docs/SECURITY.md).
