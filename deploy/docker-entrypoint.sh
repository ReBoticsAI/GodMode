#!/bin/sh
set -e

# Allow the production plugin import map under CSP (inline maps need a sha256 allowlist).
HASH_FILE=/usr/share/nginx/html/.importmap-csp-hash
NGINX_CONF=/etc/nginx/conf.d/default.conf
if [ -f "$HASH_FILE" ] && [ -f "$NGINX_CONF" ]; then
  HASH=$(tr -d '\r\n' < "$HASH_FILE")
  if [ -n "$HASH" ]; then
    sed -i "s|__GODMODE_IMPORTMAP_HASH__|'sha256-${HASH}'|g" "$NGINX_CONF"
  else
    sed -i "s|__GODMODE_IMPORTMAP_HASH__||g" "$NGINX_CONF"
  fi
elif [ -f "$NGINX_CONF" ]; then
  sed -i "s|__GODMODE_IMPORTMAP_HASH__||g" "$NGINX_CONF"
fi

nginx
exec node /app/apps/bridge/dist/index.js
