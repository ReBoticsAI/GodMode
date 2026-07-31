# Cloudflare edge for `app.godmode.software` (#195)

Operator runbook for putting the **SaaS app** hostname behind Cloudflare Free
(proxy, Full strict, Origin CA, WAF/DDoS) and locking the Hostinger origin firewall.

Marketing (`godmode.software` / `www`) is Cloudflare Pages (#196). Public DNS
cutover and gate sign-off are #200. This doc does **not** complete those issues.

## Locked topology

| Hostname | Edge | Origin |
|----------|------|--------|
| `app.godmode.software` | Cloudflare orange-cloud (proxied A/AAAA) | Hostinger VPS (#194) |
| `godmode.software` / `www` | Cloudflare Pages | Pages project (#196) |
| `login.godmode.software` | **Do not create** | n/a |

App routes (`/login`, `/home`) live only on `app.godmode.software`. Do not put
them on the apex.

Public URL envs on the VPS:

```text
WEB_PUBLIC_URL=https://app.godmode.software
AUTH_PUBLIC_URL=https://app.godmode.software
WEB_ORIGIN=https://app.godmode.software
```

## Prerequisites

1. **#194**: Hostinger Ubuntu VPS with Docker Compose up, public IP known,
   Bridge `:3847` not published, `/api/health` OK on origin (port 80 or 443).
2. Zone `godmode.software` added in Cloudflare (Free plan is enough for launch).
3. Operator ready to update registrar nameservers when executing #200 (do not
   flip NS until MX/email and marketing records are mirrored in Cloudflare DNS).

### Assigned Cloudflare nameservers (zone Free, pending activation)

Replace Hostinger parking NS (`hermes.dns-parking.com`, `artemis.dns-parking.com`)
**only during #200**, after #194 origin IP and #196 Pages records are ready:

```text
benedict.ns.cloudflare.com
maleah.ns.cloudflare.com
```

Do not flip NS as part of #195 alone (breaks email/DNS until records are verified).

## Checklist (maps to #195 acceptance)

### 1. Orange-cloud A/AAAA for `app.godmode.software`

1. Cloudflare Dashboard → zone `godmode.software` → **DNS**.
2. Add **A** (and **AAAA** if the VPS has IPv6) for name `app`, content =
   Hostinger public IP, **Proxy status: Proxied** (orange cloud).
3. Do **not** create `login` or apex app routes.

Until #194 provides an IP, leave this record undrafted or DNS-only with a
placeholder; never point Proxied at a random IP.

### 2. SSL/TLS Full (strict) + origin certificate

1. SSL/TLS → Overview → encryption mode **Full (strict)**.
2. SSL/TLS → Origin Server → **Create certificate** (Cloudflare Origin CA),
   hostnames: `app.godmode.software` (and `*.godmode.software` only if needed).
   Origin CA creation requires an **active** zone (nameservers verified). On a
   pending zone, Cloudflare rejects hostname validation; finish after #200 NS
   cutover (or use Let's Encrypt on the origin once `app` resolves publicly).
3. Install the Origin CA cert + key on the VPS so origin serves HTTPS on **443**.
   Options:
   - Host nginx/Caddy terminates TLS and proxies to the GodMode container `:80`
   - Or mount certs into the container and listen on 443 (compose must publish
     `443:443`; default `deploy/docker-compose.prod.yml` publishes `80:80` only)
4. Confirm Cloudflare can reach `https://<VPS-IP>/api/health` with the Origin
   CA (expect browser distrust if you hit the IP directly; that is normal for
   Origin CA).

Do not enable Full (strict) against an HTTP-only origin (525 errors).

#### Universal SSL stuck on Pending Validation (TXT)

Pages custom-domain certs cover apex/`www` only. Proxied hostnames like
`app` need zone **Universal SSL** (`*.godmode.software`). If Edge Certificates
shows **Pending Validation (TXT)** and `https://app...` fails TLS handshake
(no peer certificate), check SSL verification tokens and ensure matching
`_acme-challenge.godmode.software` **TXT** records exist in the Cloudflare DNS
zone (not only as opaque auto-DCV). After adding/updating TXT values from
SSL/TLS → Edge Certificates / verification API, PATCH recheck or wait until
the pack status is **Active**. Grey-cloud then re-proxy of `app` can also
nudge issuance.

### 3. WAF / Bot Fight

1. Security → WAF: keep managed rules enabled (Free plan defaults).
2. **Bot Fight Mode is optional for v1** (pay-first signup already gates
   tenants). Prefer enable-and-test Stripe webhooks + uptime, or leave off until
   needed. Orange-cloud still provides DDoS protection either way.
3. Optional: rate-limit rules on `/api/auth/*` and checkout paths.

### 4. Origin firewall (`ufw`)

On the VPS (after #194):

```bash
# From the repo on the VPS:
sudo ADMIN_SSH_IP=YOUR.ADMIN.IP ./deploy/ufw-origin.sh
# Prefer Cloudflare-only 80/443 when practical:
sudo CLOUDFLARE_ONLY=1 ADMIN_SSH_IP=YOUR.ADMIN.IP ./deploy/ufw-origin.sh
```

Requirements:

- SSH IP-restricted
- 80/443 only (or Cloudflare ranges only)
- **Never** publish Bridge `:3847`

### 5. `real_ip` / `CF-Connecting-IP`

The production image includes `deploy/cloudflare-realip.conf` and nginx includes
it so `$remote_addr` becomes the visitor IP from `CF-Connecting-IP`. Bridge
already trusts that header for rate limits.

Refresh the shipped IP list when Cloudflare publishes new ranges:

```bash
node deploy/scripts/refresh-cloudflare-realip.mjs
```

Rebuild/redeploy the image after refresh.

## Sequencing vs other launch issues

| Step | Issue | Notes |
|------|-------|--------|
| Provision VPS + compose | #194 | Blocks live A record + ufw + Origin CA install |
| This edge/firewall runbook + nginx real_ip | #195 | Repo work can land before #194 |
| Marketing Pages + Stripe business URL | #196 | Apex/www on Pages; needs CF zone |
| Public DNS cutover + gate sign-off | #200 | NS flip, health on `https://app.../api/health` |

Do **not** treat #200 as done when only drafting CF settings.

## Verify (after #194 + NS active)

1. `https://app.godmode.software/api/health` returns OK via Cloudflare.
2. Response headers show Cloudflare (e.g. `cf-ray`); origin IP not needed by clients.
3. Auth rate-limit logs show real client IPs (not a single CF edge IP).
4. `ufw status` shows no public `:3847`.
5. Stripe webhook and uptime checks succeed if Bot Fight was enabled.

## Rollback notes (for #200)

- Grey-cloud (DNS only) the `app` record, or point A to the previous host.
- Pause Cloudflare on the zone only as last resort (exposes origin; Origin CA
  will fail in browsers).
- Keep Hostinger NS change reversible until MX and Pages records are confirmed.
