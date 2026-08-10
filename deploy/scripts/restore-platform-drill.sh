#!/usr/bin/env bash
# Non-destructive restore drill for Docker Compose prod.
#
# Default mode (--verify-only):
#   1. Pick latest local snapshot under BACKUP_LOCAL_DIR (or /data/backups)
#   2. Copy snapshot into a scratch directory
#   3. Run SQLite integrity_check on Cloud (or legacy core),
#      Users.sqlite when present, each tenant DB, and users/*.sqlite vaults
#   4. Verify DuckDB timeseries files present, non-empty, and openable
#   5. Optionally download the same stamp from S3 into another scratch dir and
#      compare file sizes / integrity
#
# Full cutover restore (--apply) stops the godmode container, replaces live
# SQLite (Cloud, Users, user vaults, tenants) + timeseries DuckDB files from the
# snapshot, and starts the container again. Live Cloud path is Cloud.sqlite
# (archive may still include core.sqlite for legacy stamps).
# Pre-#501 stamps (core-only) still restore; hub may be empty until boot migrate.
# Use only when intentionally practicing a real restore; keep the pre-restore tree.
#
# Usage:
#   /opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only
#   /opt/godmode/deploy/scripts/restore-platform-drill.sh --verify-only --from-s3
#   /opt/godmode/deploy/scripts/restore-platform-drill.sh --apply --stamp 2026-07-31T...
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
ENV_FILE="${GODMODE_ENV_FILE:-$DEPLOY_DIR/.env.production}"
COMPOSE_FILE="${GODMODE_COMPOSE_FILE:-$DEPLOY_DIR/docker-compose.prod.yml}"
OVERRIDE_FILE="${GODMODE_COMPOSE_OVERRIDE:-$DEPLOY_DIR/docker-compose.override.yml}"
MODE="verify-only"
FROM_S3=0
STAMP=""
SCRATCH_ROOT="${GODMODE_RESTORE_SCRATCH:-/var/tmp/godmode-restore-drill}"

compose_prod() {
  local args=(--env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  if [[ "${GODMODE_COMPOSE_NO_OVERRIDE:-0}" != "1" && -f "$OVERRIDE_FILE" ]]; then
    args+=(-f "$OVERRIDE_FILE")
  fi
  (cd "$DEPLOY_DIR" && docker compose "${args[@]}" "$@")
}

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

duckdb_open_check() {
  local db="$1"
  local label
  label="$(basename "$(dirname "$db")")/$(basename "$db")"
  echo -n "  $label: "
  if [[ ! -s "$db" ]]; then
    echo "empty or missing" >&2
    return 1
  fi
  local duck_helper="$REPO_ROOT/scripts/backup/duckdb-consistent-copy.mjs"
  local duck_check="$REPO_ROOT/scripts/backup/duckdb-open-check.mjs"
  if docker run --rm --entrypoint test "$GODMODE_IMAGE" -f /app/scripts/backup/duckdb-open-check.mjs; then
    duck_helper=""
  fi
  if [[ -n "$duck_helper" ]]; then
    docker run --rm \
      -v "$db:/db.duckdb:ro" \
      -v "$duck_helper:/app/scripts/backup/duckdb-consistent-copy.mjs:ro" \
      -v "$duck_check:/app/scripts/backup/duckdb-open-check.mjs:ro" \
      -w /app \
      --entrypoint node \
      "$GODMODE_IMAGE" \
      /app/scripts/backup/duckdb-open-check.mjs /db.duckdb
  else
    docker run --rm \
      -v "$db:/db.duckdb:ro" \
      -w /app \
      --entrypoint node \
      "$GODMODE_IMAGE" \
      /app/scripts/backup/duckdb-open-check.mjs /db.duckdb
  fi
}

verify_tree() {
  local root="$1"
  local label="$2"
  echo "== integrity: $label =="
  if [[ -f "$root/databases/Cloud.sqlite" ]]; then
    integrity_check "$root/databases/Cloud.sqlite"
  elif [[ -f "$root/databases/core.sqlite" ]]; then
    integrity_check "$root/databases/core.sqlite"
  else
    echo "Snapshot missing databases/Cloud.sqlite and databases/core.sqlite" >&2
    exit 1
  fi
  if [[ -f "$root/databases/Cloud.sqlite" && -f "$root/databases/core.sqlite" ]]; then
    integrity_check "$root/databases/core.sqlite"
  fi
  if [[ -f "$root/databases/Users.sqlite" ]]; then
    integrity_check "$root/databases/Users.sqlite"
  else
    echo "  (no databases/Users.sqlite in stamp; ok for pre-hub stamps)"
  fi
  if [[ -d "$root/tenants" ]]; then
    local f
    for f in "$root/tenants"/*.sqlite; do
      [[ -e "$f" ]] || continue
      integrity_check "$f"
    done
  fi
  if [[ -d "$root/users" ]]; then
    local u
    for u in "$root/users"/*.sqlite; do
      [[ -e "$u" ]] || continue
      integrity_check "$u"
    done
  else
    echo "  (no users/ vault tree in stamp)"
  fi
  if [[ -d "$root/timeseries" ]]; then
    echo "== duckdb: $label =="
    local d
    for d in "$root/timeseries"/tenant=*/analytics.duckdb; do
      [[ -e "$d" ]] || continue
      duckdb_open_check "$d"
    done
  else
    echo "  (no timeseries/ in stamp; DuckDB not present)"
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

echo "APPLY mode: stopping Bridge and replacing live SQLite + timeseries from $SNAP"
PRE_DIR="$SCRATCH_ROOT/pre-apply-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$PRE_DIR"
compose_prod stop godmode

cp -a "$DATA_MOUNT/Cloud.sqlite" "$PRE_DIR/" 2>/dev/null || true
cp -a "$DATA_MOUNT/core.sqlite" "$PRE_DIR/" 2>/dev/null || true
cp -a "$DATA_MOUNT/Users.sqlite" "$PRE_DIR/" 2>/dev/null || true
cp -a "$DATA_MOUNT/tenants" "$PRE_DIR/" 2>/dev/null || true
cp -a "$DATA_MOUNT/users" "$PRE_DIR/" 2>/dev/null || true
cp -a "$DATA_MOUNT/timeseries" "$PRE_DIR/" 2>/dev/null || true

# Prefer databases/Cloud.sqlite; fall back to core.sqlite. Live path is Cloud.sqlite.
if [[ -f "$SNAP/databases/Cloud.sqlite" ]]; then
  cp -a "$SNAP/databases/Cloud.sqlite" "$DATA_MOUNT/Cloud.sqlite"
elif [[ -f "$SNAP/databases/core.sqlite" ]]; then
  cp -a "$SNAP/databases/core.sqlite" "$DATA_MOUNT/Cloud.sqlite"
else
  echo "Snapshot missing databases/Cloud.sqlite (and core.sqlite)" >&2
  exit 1
fi
rm -f "$DATA_MOUNT/Cloud.sqlite-wal" "$DATA_MOUNT/Cloud.sqlite-shm"
# Drop leftover legacy live core so boot does not see both files.
rm -f "$DATA_MOUNT/core.sqlite" "$DATA_MOUNT/core.sqlite-wal" "$DATA_MOUNT/core.sqlite-shm"

if [[ -f "$SNAP/databases/Users.sqlite" ]]; then
  cp -a "$SNAP/databases/Users.sqlite" "$DATA_MOUNT/Users.sqlite"
  rm -f "$DATA_MOUNT/Users.sqlite-wal" "$DATA_MOUNT/Users.sqlite-shm"
fi

mkdir -p "$DATA_MOUNT/tenants"
for f in "$SNAP/tenants"/*.sqlite; do
  [[ -e "$f" ]] || continue
  base="$(basename "$f")"
  cp -a "$f" "$DATA_MOUNT/tenants/$base"
  rm -f "$DATA_MOUNT/tenants/${base}-wal" "$DATA_MOUNT/tenants/${base}-shm"
done

if [[ -d "$SNAP/users" ]]; then
  mkdir -p "$DATA_MOUNT/users"
  for f in "$SNAP/users"/*.sqlite; do
    [[ -e "$f" ]] || continue
    base="$(basename "$f")"
    cp -a "$f" "$DATA_MOUNT/users/$base"
    rm -f "$DATA_MOUNT/users/${base}-wal" "$DATA_MOUNT/users/${base}-shm"
  done
fi

if [[ -d "$SNAP/timeseries" ]]; then
  mkdir -p "$DATA_MOUNT/timeseries"
  for d in "$SNAP/timeseries"/tenant=*; do
    [[ -d "$d" ]] || continue
    base="$(basename "$d")"
    mkdir -p "$DATA_MOUNT/timeseries/$base"
    if [[ -f "$d/analytics.duckdb" ]]; then
      cp -a "$d/analytics.duckdb" "$DATA_MOUNT/timeseries/$base/analytics.duckdb"
    fi
  done
fi

compose_prod start godmode
sleep 3
curl -fsS "${AUTH_PUBLIC_URL:-http://127.0.0.1}/api/health" | head -c 400
echo
echo "Apply restore done. Pre-apply tree: $PRE_DIR"
