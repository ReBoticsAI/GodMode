# Cloudflare (or similar CDN) in front of a SaaS origin

Generic guidance for putting the **authenticated app** hostname behind a CDN
proxy (Cloudflare Free is enough for many launches): Full (strict) TLS to origin,
WAF/DDoS at the edge, and a locked origin firewall.

Marketing on a separate apex/`www` host (for example Cloudflare Pages) is covered
in [`cloudflare-pages-www.md`](cloudflare-pages-www.md). Keep app routes
(`/login`, `/home`, APIs) on the app hostname only. Do not put them on the apex.

## Topology (example)

| Hostname | Edge | Origin |
|----------|------|--------|
| `app.example.com` | CDN proxied A/AAAA | Your VPS (Docker Compose) |
| `example.com` / `www` | Static host / Pages | Marketing build |
| `login.example.com` | Prefer **not** creating | Use `/login` on the app host |

Public URL envs on the origin:

```text
WEB_PUBLIC_URL=https://app.example.com
AUTH_PUBLIC_URL=https://app.example.com
WEB_ORIGIN=https://app.example.com
```

## Prerequisites

1. Origin up: Docker Compose healthy, Bridge `:3847` **not** published publicly,
   `/api/health` OK on the origin HTTP(S) port the proxy will hit.
2. DNS zone for your domain at the CDN (or ready to cut nameservers over).
3. Do not flip registrar nameservers until mail and marketing DNS records are
   mirrored and verified.

## Checklist

### 1. Proxied DNS for the app hostname

1. Add **A** (and **AAAA** if you have IPv6) for `app` → origin public IP.
2. Enable CDN proxy (orange-cloud on Cloudflare).
3. Do not create a separate `login` hostname unless you have a strong reason.

### 2. SSL/TLS Full (strict) + origin certificate

1. Set encryption mode to **Full (strict)** (or equivalent: CDN verifies a valid
   origin cert).
2. Issue an origin certificate (Cloudflare Origin CA, Let's Encrypt, etc.) for
   `app.example.com`.
3. Terminate TLS on the host (nginx/Caddy → container `:80`) or inside the
   container if you publish `443:443`. Default
   `deploy/docker-compose.prod.yml` publishes `80:80` only.
4. Do not enable Full (strict) against an HTTP-only origin (525-class errors).

If edge certificates stick on pending DNS validation, ensure ACME/TXT challenge
records exist in the **same** DNS zone the CDN uses, then recheck issuance.

### 3. WAF / bot controls

1. Keep managed WAF rules enabled when available.
2. Aggressive bot modes are optional when signup is already paywalled. If you
   enable them, verify Stripe webhooks and uptime checks still succeed.
3. Optional: edge rate limits on `/api/auth/*` and checkout paths.

### 4. Origin firewall

```bash
sudo ADMIN_SSH_IP=YOUR.ADMIN.IP ./deploy/ufw-origin.sh
# Prefer CDN-only 80/443 when practical:
sudo CLOUDFLARE_ONLY=1 ADMIN_SSH_IP=YOUR.ADMIN.IP ./deploy/ufw-origin.sh
```

Requirements:

- SSH IP-restricted
- 80/443 only (or CDN IP ranges only)
- **Never** publish Bridge `:3847`

For loopback publish behind host TLS, copy
[`docker-compose.loopback-override.example.yml`](docker-compose.loopback-override.example.yml)
to `docker-compose.override.yml` on the host (gitignored).

### 5. Client IP for rate limits

The production image includes `deploy/cloudflare-realip.conf` so nginx sets
`$remote_addr` from `CF-Connecting-IP`. Bridge trusts that header for rate limits.

Refresh the shipped Cloudflare IP list when ranges change:

```bash
node deploy/scripts/refresh-cloudflare-realip.mjs
```

Rebuild/redeploy the image after refresh. Other CDNs need an equivalent real-ip
module and trusted header configuration.

## Verify

1. `https://app.example.com/api/health` returns OK via the CDN.
2. Response headers show the CDN (for example `cf-ray` on Cloudflare).
3. Auth rate-limit logs show real client IPs (not a single edge IP).
4. Firewall shows no public `:3847`.
5. Stripe webhook and uptime checks succeed if bot mode was enabled.

## Rollback

- Disable proxy (DNS-only) on the app record, or point A/AAAA at a previous host.
- Pausing the CDN zone entirely exposes the origin; treat as last resort.
