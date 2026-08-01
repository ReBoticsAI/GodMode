#!/usr/bin/env bash
# Retain only the currently running GodMode image plus one previous image.
# Call after a successful compose pull + up so digests from frequent redeploys
# do not accumulate on the host.
#
# Usage (on the VPS):
#   /opt/godmode/deploy/scripts/prune-old-images.sh
#   /opt/godmode/deploy/scripts/prune-old-images.sh --previous 'ghcr.io/reboticsai/godmode@sha256:...'
#   GODMODE_IMAGE_REPO=ghcr.io/reboticsai/godmode ./prune-old-images.sh --dry-run
#
# Without --previous, keeps the newest non-running local image for the repo as
# the rollback candidate. Refuses to prune if no running GodMode container is found.
set -euo pipefail

REPO="${GODMODE_IMAGE_REPO:-ghcr.io/reboticsai/godmode}"
PREVIOUS_REF=""
DRY_RUN=0
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GODMODE_ENV_FILE:-$DEPLOY_DIR/.env.production}"
COMPOSE_FILE="${GODMODE_COMPOSE_FILE:-$DEPLOY_DIR/docker-compose.prod.yml}"
OVERRIDE_FILE="${GODMODE_COMPOSE_OVERRIDE:-$DEPLOY_DIR/docker-compose.override.yml}"
LOG_TAG="prune-old-images"

compose_prod() {
  local args=(--env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  if [[ "${GODMODE_COMPOSE_NO_OVERRIDE:-0}" != "1" && -f "$OVERRIDE_FILE" ]]; then
    args+=(-f "$OVERRIDE_FILE")
  fi
  (cd "$DEPLOY_DIR" && docker compose "${args[@]}" "$@")
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --previous)
      PREVIOUS_REF="${2:?--previous requires an image ref}"
      shift 2
      ;;
    --repo)
      REPO="${2:?--repo requires a repository name}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "$LOG_TAG: unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

normalize_id() {
  local id="$1"
  id="${id#sha256:}"
  printf 'sha256:%s\n' "$id"
}

resolve_image_id() {
  local ref="$1"
  [[ -z "$ref" ]] && return 1
  docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null | head -n1
}

current_id=""
if [[ -f "$ENV_FILE" ]]; then
  cid="$(compose_prod ps -q godmode 2>/dev/null || true)"
  if [[ -n "${cid:-}" ]]; then
    current_id="$(docker inspect --format '{{.Image}}' "$cid")"
  fi
fi

if [[ -z "$current_id" ]]; then
  while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    cfg="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
    case "$cfg" in
      *"$REPO"*)
        current_id="$(docker inspect --format '{{.Image}}' "$cid")"
        break
        ;;
    esac
  done < <(docker ps -q)
fi

if [[ -z "$current_id" ]]; then
  echo "$LOG_TAG: no running GodMode container found; refusing to prune" >&2
  exit 1
fi
current_id="$(normalize_id "$current_id")"

previous_id=""
if [[ -n "$PREVIOUS_REF" ]]; then
  resolved="$(resolve_image_id "$PREVIOUS_REF" || true)"
  if [[ -n "${resolved:-}" ]]; then
    previous_id="$(normalize_id "$resolved")"
  else
    echo "$LOG_TAG: --previous not present locally (skipped): $PREVIOUS_REF" >&2
  fi
fi

if [[ -n "$previous_id" && "$previous_id" == "$current_id" ]]; then
  previous_id=""
fi

if [[ -z "$previous_id" ]]; then
  while IFS=$'\t' read -r id _created; do
    [[ -z "$id" ]] && continue
    nid="$(normalize_id "$id")"
    [[ "$nid" == "$current_id" ]] && continue
    previous_id="$nid"
    break
  done < <(docker images --no-trunc --format '{{.ID}}\t{{.CreatedAt}}' "$REPO" | sort -k2 -r)
fi

echo "$LOG_TAG: repo=$REPO"
echo "$LOG_TAG: keep current=$current_id"
if [[ -n "$previous_id" ]]; then
  echo "$LOG_TAG: keep previous=$previous_id"
else
  echo "$LOG_TAG: keep previous=(none)"
fi

removed=0
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  nid="$(normalize_id "$id")"
  if [[ "$nid" == "$current_id" ]]; then
    continue
  fi
  if [[ -n "$previous_id" && "$nid" == "$previous_id" ]]; then
    continue
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "$LOG_TAG: would remove $nid"
  else
    echo "$LOG_TAG: remove $nid"
    docker rmi "$nid" || true
  fi
  removed=$((removed + 1))
done < <(docker images -q --no-trunc "$REPO" | sort -u)

echo "$LOG_TAG: done (removed=$removed)"
