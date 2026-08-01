#!/usr/bin/env bash
# Pull a nightly platform backup stamp from the VPS onto this machine (operator
# offsite). Prefer the closed snapshot under the data volume backups dir, not a
# live copy of core/tenants while Bridge writers are open.
#
# Usage (from a machine with SSH to the VPS):
#   GODMODE_VPS=root@YOUR.VPS.IP ./deploy/scripts/pull-platform-backup.sh
#   GODMODE_VPS=root@IP DEST="$HOME/GodMode-backups" STAMP=2026-08-01T00-14-00-338Z \
#     ./deploy/scripts/pull-platform-backup.sh
#
# After pull: compare SHA-256 of *.sqlite + manifest.json to the VPS, then run
#   ssh "$GODMODE_VPS" '/opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only --stamp <stamp>'
# (integrity uses the same stamp; matching checksums means your local tree is that verified copy.)
#
# Env:
#   GODMODE_VPS   required, e.g. root@203.0.113.10
#   DEST          local parent dir (default: ./GodMode-backups)
#   STAMP         snapshot id (default: latest on VPS)
#   BACKUP_HOST_ROOT  host path to backups on VPS
#                     (default: /var/lib/docker/volumes/deploy_godmode-data/_data/backups)
set -euo pipefail

: "${GODMODE_VPS:?Set GODMODE_VPS=user@host}"
DEST="${DEST:-./GodMode-backups}"
BACKUP_HOST_ROOT="${BACKUP_HOST_ROOT:-/var/lib/docker/volumes/deploy_godmode-data/_data/backups}"

if [[ -z "${STAMP:-}" ]]; then
  STAMP="$(ssh -o BatchMode=yes "$GODMODE_VPS" "ls -1 '$BACKUP_HOST_ROOT' 2>/dev/null | sort | tail -n1")"
fi
if [[ -z "$STAMP" ]]; then
  echo "No snapshot stamps under $BACKUP_HOST_ROOT on $GODMODE_VPS" >&2
  exit 1
fi

REMOTE="$BACKUP_HOST_ROOT/$STAMP"
mkdir -p "$DEST"
echo "Pulling $GODMODE_VPS:$REMOTE -> $DEST/$STAMP"
# Snapshot trees may include leftover -wal/-shm from readonly verify opens; pull
# the whole stamp, then integrity cares about the main *.sqlite files.
scp -o BatchMode=yes -r "$GODMODE_VPS:$REMOTE" "$DEST/"

echo "Local copy: $DEST/$STAMP"
echo "Next: sha256sum the *.sqlite files here and on the VPS; then:"
echo "  ssh $GODMODE_VPS '/opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only --stamp $STAMP'"
