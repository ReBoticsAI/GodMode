#!/bin/sh
set -eu

SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_ROOT=${1:-/opt/godmode}
DATA_DIR=${2:-/var/lib/godmode}
ENV_FILE=${3:-/etc/godmode/godmode.env}
SNAPSHOT_ROOT=${4:-/var/backups/godmode}
READINESS_URL=${5:-http://127.0.0.1:8080/api/update/readiness}
: "${UPDATE_READINESS_TOKEN:?UPDATE_READINESS_TOKEN is required}"
[ "$(id -u)" -eq 0 ] || { printf '%s\n' "Run this installer as root" >&2; exit 1; }
case "$UPDATE_READINESS_TOKEN${UPDATE_SUPERVISOR_TOKEN:-}${UPDATE_RELEASE_REPOSITORY:-}" in
  *'
'*) printf '%s\n' "Update configuration values must be single-line" >&2; exit 1 ;;
esac

VERSION=$("$SOURCE/bin/node" -e 'process.stdout.write(require(process.argv[1]).version)' "$SOURCE/release.json")
case "$VERSION" in
  v[0-9]*.[0-9]*.[0-9]*|v[0-9]*.[0-9]*.[0-9]*-nightly.*) ;;
  *) printf 'Invalid release identity: %s\n' "$VERSION" >&2; exit 1 ;;
esac
TARGET="$INSTALL_ROOT/releases/$VERSION"
PREVIOUS=$(readlink "$INSTALL_ROOT/current" 2>/dev/null || true)
SNAPSHOT="$SNAPSHOT_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$VERSION"
mkdir -p "$INSTALL_ROOT/releases" "$DATA_DIR" "$SNAPSHOT" "$(dirname "$ENV_FILE")"
if ! getent group godmode >/dev/null; then groupadd --system godmode; fi
if ! id godmode >/dev/null 2>&1; then
  useradd --system --gid godmode --home-dir "$DATA_DIR" --shell /usr/sbin/nologin godmode
fi
touch "$ENV_FILE"
printf 'UPDATE_READINESS_TOKEN=%s\n' "$UPDATE_READINESS_TOKEN" >> "$ENV_FILE"
if [ -n "${UPDATE_SUPERVISOR_TOKEN:-}" ]; then
  printf 'UPDATE_SUPERVISOR_TOKEN=%s\n' "$UPDATE_SUPERVISOR_TOKEN" >> "$ENV_FILE"
  printf '%s\n' 'UPDATE_SUPERVISOR_URL=http://127.0.0.1:8791' >> "$ENV_FILE"
fi
chown root:godmode "$ENV_FILE"
chmod 640 "$ENV_FILE"
chown -R godmode:godmode "$DATA_DIR"

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop godmode.service 2>/dev/null || true
fi
tar -czf "$SNAPSHOT/data.tar.gz" -C "$DATA_DIR" .
sha256sum "$SNAPSHOT/data.tar.gz" > "$SNAPSHOT/SHA256SUMS"

rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -a "$SOURCE/." "$TARGET/"
rm -f "$INSTALL_ROOT/current.next"
ln -s "$TARGET" "$INSTALL_ROOT/current.next"
mv -Tf "$INSTALL_ROOT/current.next" "$INSTALL_ROOT/current"
if [ -n "$PREVIOUS" ]; then
  ln -sfn "$PREVIOUS" "$INSTALL_ROOT/previous"
fi
sed \
  -e "s#/opt/godmode#$INSTALL_ROOT#g" \
  -e "s#/var/lib/godmode#$DATA_DIR#g" \
  -e "s#/etc/godmode/godmode.env#$ENV_FILE#g" \
  "$TARGET/godmode.service" > /etc/systemd/system/godmode.service
sed \
  -e "s#/opt/godmode#$INSTALL_ROOT#g" \
  "$TARGET/godmode-update-supervisor.service" \
  > /etc/systemd/system/godmode-update-supervisor.service
if [ -n "${UPDATE_SUPERVISOR_TOKEN:-}" ]; then
  UPDATE_ENV=/etc/godmode/update.env
  : > "$UPDATE_ENV"
  printf 'UPDATE_SUPERVISOR_TOKEN=%s\n' "$UPDATE_SUPERVISOR_TOKEN" >> "$UPDATE_ENV"
  printf 'UPDATE_READINESS_TOKEN=%s\n' "$UPDATE_READINESS_TOKEN" >> "$UPDATE_ENV"
  if [ -n "${UPDATE_RELEASE_REPOSITORY:-}" ]; then
    printf 'UPDATE_RELEASE_REPOSITORY=%s\n' "$UPDATE_RELEASE_REPOSITORY" >> "$UPDATE_ENV"
  fi
  chmod 600 "$UPDATE_ENV"
fi
systemctl daemon-reload
systemctl enable godmode.service
if [ -n "${UPDATE_SUPERVISOR_TOKEN:-}" ]; then
  systemctl enable --now godmode-update-supervisor.service
fi
systemctl start godmode.service

attempt=1
while [ "$attempt" -le 60 ]; do
  if curl --fail --silent \
    -H "Authorization: Bearer $UPDATE_READINESS_TOKEN" \
    "$READINESS_URL" >/dev/null; then
    printf 'Installed GodMode %s; snapshot retained at %s\n' "$VERSION" "$SNAPSHOT"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done

systemctl stop godmode.service || true
if [ -n "$PREVIOUS" ]; then
  ln -sfn "$PREVIOUS" "$INSTALL_ROOT/current"
fi
find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -xzf "$SNAPSHOT/data.tar.gz" -C "$DATA_DIR"
if [ -n "$PREVIOUS" ]; then systemctl start godmode.service || true; fi
printf '%s\n' "Readiness failed; restored the previous runtime and data snapshot" >&2
exit 1
