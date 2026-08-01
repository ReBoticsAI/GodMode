#!/usr/bin/env bash
# Run platform SQLite + DuckDB timeseries snapshot (local + optional BACKUP_S3_*
# upload) against the live Docker Compose prod data volume. Intended for
# Hostinger cron.
#
# Usage (on the VPS):
#   /opt/godmode/deploy/scripts/run-platform-backup.sh
#
# Env file: deploy/.env.production (GODMODE_IMAGE, optional BACKUP_S3_*).
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
ENV_FILE="${GODMODE_ENV_FILE:-$DEPLOY_DIR/.env.production}"
COMPOSE_FILE="${GODMODE_COMPOSE_FILE:-$DEPLOY_DIR/docker-compose.prod.yml}"
LOG_TAG="godmode-backup"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$LOG_TAG: missing env file: $ENV_FILE" >&2
  exit 1
fi

# Load KEY=value lines without executing shell metacharacters.
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  fi
done < "$ENV_FILE"

: "${GODMODE_IMAGE:?GODMODE_IMAGE must be set in $ENV_FILE}"
export PLATFORM_DATA_DIR="${PLATFORM_DATA_DIR:-/data}"
export BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/data/backups}"

VOLUME_NAME="${GODMODE_DATA_VOLUME:-}"
if [[ -z "$VOLUME_NAME" ]]; then
  # Default Compose project directory name is "deploy" → deploy_godmode-data
  VOLUME_NAME="$(docker volume ls --format '{{.Name}}' | grep -E '_?godmode-data$' | head -n1 || true)"
fi
if [[ -z "$VOLUME_NAME" ]]; then
  echo "$LOG_TAG: could not find godmode-data Docker volume" >&2
  exit 1
fi

SCRIPT_IN_IMAGE=0
if docker run --rm --entrypoint test "$GODMODE_IMAGE" -f /app/scripts/backup/snapshot-platform.mjs; then
  SCRIPT_IN_IMAGE=1
fi

COMMON_ARGS=(
  --rm
  -e PLATFORM_DATA_DIR
  -e BACKUP_LOCAL_DIR
  -e BACKUP_S3_ENDPOINT
  -e BACKUP_S3_REGION
  -e BACKUP_S3_BUCKET
  -e BACKUP_S3_ACCESS_KEY_ID
  -e BACKUP_S3_SECRET_ACCESS_KEY
  -e BACKUP_S3_PREFIX
  -v "${VOLUME_NAME}:/data"
  -w /app
  --entrypoint node
)

if [[ "$SCRIPT_IN_IMAGE" -eq 1 ]]; then
  echo "$LOG_TAG: snapshot via image script (volume=$VOLUME_NAME)"
  docker run "${COMMON_ARGS[@]}" "$GODMODE_IMAGE" \
    /app/scripts/backup/snapshot-platform.mjs
else
  HOST_SCRIPT="$REPO_ROOT/scripts/backup/snapshot-platform.mjs"
  if [[ ! -f "$HOST_SCRIPT" ]]; then
    echo "$LOG_TAG: snapshot script missing in image and at $HOST_SCRIPT" >&2
    exit 1
  fi
  echo "$LOG_TAG: snapshot via host-mounted script (volume=$VOLUME_NAME)"
  docker run "${COMMON_ARGS[@]}" \
    -v "$HOST_SCRIPT:/app/scripts/backup/snapshot-platform.mjs:ro" \
    "$GODMODE_IMAGE" \
    /app/scripts/backup/snapshot-platform.mjs
fi
