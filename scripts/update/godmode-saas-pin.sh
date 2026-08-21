#!/bin/sh
# Pin GODMODE_IMAGE to an immutable digest and roll SaaS compose.
# Never dumps .env.production. Intended for a pin-only self-hosted runner (or manual ops).
#
# Usage:
#   godmode-saas-pin.sh <image@digest|image> [deploy-dir] [health-url]
#
# Env overrides:
#   GODMODE_DEPLOY_DIR   default /opt/godmode/deploy
#   GODMODE_ENV_FILE     default .env.production (relative to deploy dir)
#   GODMODE_COMPOSE_FILES  space-separated compose -f args
#                          default: docker-compose.prod.yml docker-compose.override.yml
#   GODMODE_HEALTH_ATTEMPTS  default 60 (2s sleep between tries ≈ 2 minutes)

set -eu

IMAGE_REF=${1:?Usage: godmode-saas-pin.sh <image@sha256:digest> [deploy-dir] [health-url]}
DEPLOY_DIR=${2:-${GODMODE_DEPLOY_DIR:-/opt/godmode/deploy}}
HEALTH_URL=${3:-${GODMODE_HEALTH_URL:-http://127.0.0.1:8080/api/health}}
ENV_FILE=${GODMODE_ENV_FILE:-.env.production}
HEALTH_ATTEMPTS=${GODMODE_HEALTH_ATTEMPTS:-60}

case "$IMAGE_REF" in
  *@sha256:*) ;;
  *)
    printf '%s\n' "Refusing mutable pin without @sha256: digest: $IMAGE_REF" >&2
    exit 1
    ;;
esac

cd "$DEPLOY_DIR"
if [ ! -f "$ENV_FILE" ]; then
  printf '%s\n' "Missing env file: $DEPLOY_DIR/$ENV_FILE" >&2
  exit 1
fi

PRIOR=$(grep -E '^GODMODE_IMAGE=' "$ENV_FILE" | cut -d= -f2- || true)
# Rewrite only the GODMODE_IMAGE line; never print the file.
if grep -qE '^GODMODE_IMAGE=' "$ENV_FILE"; then
  sed -i.bak "s|^GODMODE_IMAGE=.*|GODMODE_IMAGE=${IMAGE_REF}|" "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
else
  printf '\nGODMODE_IMAGE=%s\n' "$IMAGE_REF" >> "$ENV_FILE"
fi

printf '%s\n' "Prior GODMODE_IMAGE=${PRIOR:-<unset>}"
printf '%s\n' "New GODMODE_IMAGE=${IMAGE_REF}"

COMPOSE_FILES=${GODMODE_COMPOSE_FILES:-"docker-compose.prod.yml docker-compose.override.yml"}
set --
for f in $COMPOSE_FILES; do
  if [ -f "$f" ]; then
    set -- "$@" -f "$f"
  fi
done
if [ "$#" -eq 0 ]; then
  printf '%s\n' "No compose files found under $DEPLOY_DIR" >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" "$@" pull
docker compose --env-file "$ENV_FILE" "$@" up -d --remove-orphans

# Nginx/Bridge need time after recreate. Match godmode-update.sh readiness loop.
# Do not require writing the body to disk (curl 23 on full/readonly /tmp).
attempt=1
code=000
while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)
  printf '%s\n' "Health attempt ${attempt}/${HEALTH_ATTEMPTS}: HTTP ${code} (${HEALTH_URL})"
  if [ "$code" = "200" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$code" != "200" ]; then
  printf '%s\n' "Health check failed after ${HEALTH_ATTEMPTS} attempts (last HTTP ${code})" >&2
  docker compose --env-file "$ENV_FILE" "$@" ps || true
  docker compose --env-file "$ENV_FILE" "$@" logs --tail 120 || true
  exit 1
fi

if [ -x ./scripts/prune-old-images.sh ]; then
  ./scripts/prune-old-images.sh --previous "${PRIOR:-}" || true
elif [ -x ../scripts/prune-old-images.sh ]; then
  ../scripts/prune-old-images.sh --previous "${PRIOR:-}" || true
fi

printf '%s\n' "Pin and roll OK"
