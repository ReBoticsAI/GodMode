#!/usr/bin/env bash
# Origin firewall for Hostinger VPS behind Cloudflare (issue #195).
# Run as root on the VPS after #194 is provisioned.
#
# Usage:
#   ADMIN_SSH_IP=203.0.113.10 ./deploy/ufw-origin.sh
# Optional Cloudflare-only HTTP(S):
#   CLOUDFLARE_ONLY=1 ADMIN_SSH_IP=203.0.113.10 ./deploy/ufw-origin.sh
#
# Never opens Bridge :3847. Prefer Cloudflare IP allowlist for 80/443 when practical.

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (ufw)." >&2
  exit 1
fi

if [[ -z "${ADMIN_SSH_IP:-}" ]]; then
  echo "Set ADMIN_SSH_IP to your admin public IP for SSH." >&2
  exit 1
fi

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

ufw allow from "${ADMIN_SSH_IP}" to any port 22 proto tcp comment 'admin SSH'

if [[ "${CLOUDFLARE_ONLY:-0}" == "1" ]]; then
  echo "Allowing 80/443 from Cloudflare published ranges only..."
  mapfile -t CF_V4 < <(curl -fsSL https://www.cloudflare.com/ips-v4)
  mapfile -t CF_V6 < <(curl -fsSL https://www.cloudflare.com/ips-v6)
  for cidr in "${CF_V4[@]}"; do
    [[ -n "$cidr" ]] || continue
    ufw allow from "$cidr" to any port 80 proto tcp comment 'Cloudflare HTTP'
    ufw allow from "$cidr" to any port 443 proto tcp comment 'Cloudflare HTTPS'
  done
  for cidr in "${CF_V6[@]}"; do
    [[ -n "$cidr" ]] || continue
    ufw allow from "$cidr" to any port 80 proto tcp comment 'Cloudflare HTTP v6'
    ufw allow from "$cidr" to any port 443 proto tcp comment 'Cloudflare HTTPS v6'
  done
else
  ufw allow 80/tcp comment 'HTTP (Cloudflare or ACME)'
  ufw allow 443/tcp comment 'HTTPS origin (Full strict)'
fi

ufw --force enable
ufw status verbose

echo
echo "Verify Bridge :3847 is NOT listening publicly (compose must not publish 3847)."
echo "Next: install Origin CA or Let's Encrypt, set Cloudflare SSL to Full (strict)."
