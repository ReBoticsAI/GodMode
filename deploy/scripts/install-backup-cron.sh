#!/usr/bin/env bash
# Install root crontab entry for nightly platform backups on Docker prod.
#
# Usage:
#   sudo /opt/godmode/deploy/scripts/install-backup-cron.sh
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$DEPLOY_DIR/scripts/run-platform-backup.sh"
LOG_FILE="${GODMODE_BACKUP_LOG:-/var/log/godmode-backup.log}"
# 03:15 UTC daily
CRON_SCHEDULE="${GODMODE_BACKUP_CRON:-15 3 * * *}"
MARKER="# godmode-platform-backup"

chmod +x "$RUNNER" "$DEPLOY_DIR/scripts/install-backup-cron.sh"

touch "$LOG_FILE"
chmod 640 "$LOG_FILE"

LINE="$CRON_SCHEDULE $RUNNER >> $LOG_FILE 2>&1 $MARKER"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -vF "$MARKER" || true)"
printf '%s\n%s\n' "$FILTERED" "$LINE" | sed '/^$/d' | crontab -

echo "Installed cron:"
crontab -l | grep -F "$MARKER" || true
echo "Log: $LOG_FILE"
echo "Runner: $RUNNER"
