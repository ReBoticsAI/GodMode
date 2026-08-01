#!/usr/bin/env bash
# Deny WAN access to Layer 4 supervisor ports (8792 API, 8793 egress proxy).
# Docker published ports bypass UFW; lock the public NIC via iptables INPUT +
# DOCKER-USER. Bridge still reaches the supervisor via host.docker.internal
# (docker bridge / host-gateway), which does not arrive on the public iface.
#
#   sudo /opt/godmode/deploy/scripts/lock-build-supervisor-wan.sh
#   # optional persist (Debian/Ubuntu):
#   sudo apt-get install -y iptables-persistent
#   sudo netfilter-persistent save

set -euo pipefail

PORTS=(8792 8793)

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

PUBLIC_IF="${PUBLIC_IF:-$(ip -4 route show default 2>/dev/null | awk '{print $5; exit}')}"
if [[ -z "${PUBLIC_IF}" ]]; then
  echo "Could not detect default IPv4 interface. Set PUBLIC_IF=eth0 (or similar)." >&2
  exit 1
fi

ensure_drop() {
  local table="$1" # filter
  local chain="$2"
  local iface="$3"
  local port="$4"
  if iptables -t "${table}" -C "${chain}" -i "${iface}" -p tcp --dport "${port}" -j DROP 2>/dev/null; then
    return 0
  fi
  iptables -t "${table}" -I "${chain}" -i "${iface}" -p tcp --dport "${port}" -j DROP
  echo "Added iptables ${chain} DROP ${iface} tcp/${port}"
}

ensure_drop6() {
  local chain="$1"
  local iface="$2"
  local port="$3"
  if ! command -v ip6tables >/dev/null 2>&1; then
    return 0
  fi
  if ip6tables -C "${chain}" -i "${iface}" -p tcp --dport "${port}" -j DROP 2>/dev/null; then
    return 0
  fi
  ip6tables -I "${chain}" -i "${iface}" -p tcp --dport "${port}" -j DROP
  echo "Added ip6tables ${chain} DROP ${iface} tcp/${port}"
}

# Ensure DOCKER-USER exists (Docker creates it when the daemon is up).
if ! iptables -L DOCKER-USER -n >/dev/null 2>&1; then
  iptables -N DOCKER-USER
  iptables -I FORWARD -j DOCKER-USER
fi

for port in "${PORTS[@]}"; do
  ensure_drop filter INPUT "${PUBLIC_IF}" "${port}"
  ensure_drop filter DOCKER-USER "${PUBLIC_IF}" "${port}"
  ensure_drop6 INPUT "${PUBLIC_IF}" "${port}"
  if ip6tables -L DOCKER-USER -n >/dev/null 2>&1; then
    ensure_drop6 DOCKER-USER "${PUBLIC_IF}" "${port}"
  fi
done

echo "Locked supervisor ports on public iface ${PUBLIC_IF} (${PORTS[*]})."
echo "Verify from an external host: nc -vz <vps-ip> 8792  (should fail)."
echo "Verify on VPS: curl -fsS http://127.0.0.1:8792/health"
