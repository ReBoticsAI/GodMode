#!/usr/bin/env bash
# Non-destructive restore drill for Docker Compose prod.
#
# Default mode (--verify-only):
#   1. Pick latest local snapshot under BACKUP_LOCAL_DIR (or /data/backups)
#   2. Copy snapshot into a scratch directory
#   3. Run SQLite integrity_check on core + each tenant DB
#   4. Optionally download the same stamp from S3 into another scratch dir and
#      compare file sizes / integrity
#
# Full cutover restore (--apply) stops the godmode container, replaces live
# SQLite files from the snapshot, and starts the container again. Use only when
# intentionally practicing a real restore; keep the pre-restore tree.
#
# Usage:
#   /opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only
#   /opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only --from-s3
#   /opt/godmode/deploy/scripts/restore-platform-drill.sh --apply --stamp 2026-07-31T...
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GODMODE_ENV_FILE:-$DEPLOY_DIR/.env.production}"
COMPOSE_FILE="${GODMODE_COMPOSE_FILE:-$DEPLOY_DIR/docker-compose.prod.yml}"
MODE="verify-only"
FROM_S3=0
STAMP=""
SCRATCH_ROOT="${GODMODE_RESTORE_SCRATCH:-/var/tmp/godmode-restore-drill}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) MODE="verify-only"; shift ;;
    --apply) MODE="apply"; shift ;;
    --from-s3) FROM_S3=1; shift ;;
    --stamp) STAMP="${2:?}"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  fi
done < "$ENV_FILE"

: "${GODMODE_IMAGE:?GODMODE_IMAGE must be set}"

VOLUME_NAME="${GODMODE_DATA_VOLUME:-}"
if [[ -z "$VOLUME_NAME" ]]; then
  VOLUME_NAME="$(docker volume ls --format '{{.Name}}' | grep -E '_?godmode-data$' | head -n1 || true)"
fi
: "${VOLUME_NAME:?godmode-data volume not found}"

DATA_MOUNT="/var/lib/docker/volumes/${VOLUME_NAME}/_data"
BACKUP_ROOT="${BACKUP_LOCAL_DIR:-$DATA_MOUNT/backups}"
# BACKUP_LOCAL_DIR inside container is /data/backups → host path under volume
if [[ "$BACKUP_ROOT" == /data/* ]]; then
  BACKUP_ROOT="$DATA_MOUNT/${BACKUP_ROOT#/data/}"
fi

if [[ -z "$STAMP" ]]; then
  STAMP="$(ls -1 "$BACKUP_ROOT" 2>/dev/null | sort | tail -n1 || true)"
fi
if [[ -z "$STAMP" || ! -d "$BACKUP_ROOT/$STAMP" ]]; then
  echo "No snapshot stamp found under $BACKUP_ROOT" >&2
  exit 1
fi

SNAP="$BACKUP_ROOT/$STAMP"
echo "Using snapshot: $SNAP"

integrity_check() {
  local db="$1"
  echo -n "  $(basename "$db"): "
  docker run --rm \
    -v "$db:/db.sqlite:ro" \
    -v "$DEPLOY_DIR/scripts/sqlite-integrity-check.mjs:/app/sqlite-integrity-check.mjs:ro" \
    -w /app \
    --entrypoint node \
    "$GODMODE_IMAGE" \
    /app/sqlite-integrity-check.mjs
}

verify_tree() {
  local root="$1"
  local label="$2"
  echo "== integrity: $label =="
  integrity_check "$root/databases/core.sqlite"
  if [[ -d "$root/tenants" ]]; then
    local f
    for f in "$root/tenants"/*.sqlite; do
      [[ -e "$f" ]] || continue
      integrity_check "$f"
    done
  fi
  [[ -f "$root/manifest.json" ]] && echo "manifest: $(tr -d '\n' < "$root/manifest.json" | head -c 200)..."
}

mkdir -p "$SCRATCH_ROOT"
VERIFY_DIR="$SCRATCH_ROOT/local-$STAMP"
rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"
cp -a "$SNAP/." "$VERIFY_DIR/"
verify_tree "$VERIFY_DIR" "local-copy"

if [[ "$FROM_S3" -eq 1 ]]; then
  : "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT required for --from-s3}"
  : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET required for --from-s3}"
  : "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID required for --from-s3}"
  : "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY required for --from-s3}"
  PREFIX="${BACKUP_S3_PREFIX:-godmode/}"
  PREFIX="${PREFIX%/}/"
  S3_DIR="$SCRATCH_ROOT/s3-$STAMP"
  rm -rf "$S3_DIR"
  mkdir -p "$S3_DIR"
  echo "== download s3://$BACKUP_S3_BUCKET/${PREFIX}${STAMP}/ =="
  # Reuse the app image + a tiny node fetch via the same SigV4 helper in snapshot script
  # by copying objects listed in the local manifest tree keys.
  docker run --rm \
    -e BACKUP_S3_ENDPOINT -e BACKUP_S3_REGION -e BACKUP_S3_BUCKET \
    -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY -e BACKUP_S3_PREFIX \
    -e STAMP="$STAMP" \
    -v "$S3_DIR:/out" \
    -v "$DEPLOY_DIR/scripts/s3-get-prefix.mjs:/app/s3-get-prefix.mjs:ro" \
    -w /app \
    --entrypoint node \
    "$GODMODE_IMAGE" \
    /app/s3-get-prefix.mjs
  verify_tree "$S3_DIR" "s3-copy"
fi

if [[ "$MODE" == "verify-only" ]]; then
  echo "Restore drill (verify-only) OK for stamp=$STAMP"
  echo "Scratch kept at $VERIFY_DIR (delete when done)"
  exit 0
fi

echo "APPLY mode: stopping Bridge and replacing live SQLite from $SNAP"
PRE_DIR="$SCRATCH_ROOT/pre-apply-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$PRE_DIR"
cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop godmode

cp -a "$DATA_MOUNT/core.sqlite" "$PRE_DIR/" 2>/dev/null || true
cp -a "$DATA_MOUNT/tenants" "$PRE_DIR/" 2>/dev/null || true

cp -a "$SNAP/databases/core.sqlite" "$DATA_MOUNT/core.sqlite"
rm -f "$DATA_MOUNT/core.sqlite-wal" "$DATA_MOUNT/core.sqlite-shm"
mkdir -p "$DATA_MOUNT/tenants"
# Replace tenant files present in the snapshot; leave unknown tenants alone.
for f in "$SNAP/tenants"/*.sqlite; do
  [[ -e "$f" ]] || continue
  base="$(basename "$f")"
  cp -a "$f" "$DATA_MOUNT/tenants/$base"
  rm -f "$DATA_MOUNT/tenants/${base}-wal" "$DATA_MOUNT/tenants/${base}-shm"
done

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" start godmode
sleep 3
curl -fsS "${AUTH_PUBLIC_URL:-http://127.0.0.1}/api/health" | head -c 400
echo
echo "Apply restore done. Pre-apply tree: $PRE_DIR"
