#!/bin/sh
# Pin GODMODE_IMAGE to an immutable digest and roll Hostinger / SaaS compose.
# Never dumps .env.production. Intended for the godmode-saas self-hosted runner.
#
# Usage:
#   godmode-saas-pin.sh <image@digest|image> [deploy-dir] [health-url]
#
# Env overrides:
#   GODMODE_DEPLOY_DIR   default /opt/godmode/deploy
#   GODMODE_ENV_FILE     default .env.production (relative to deploy dir)
#   GODMODE_COMPOSE_FILES  space-separated compose -f args
#                          default: docker-compose.prod.yml docker-compose.override.yml

set -eu

IMAGE_REF=${1:?Usage: godmode-saas-pin.sh <image@sha256:digest> [deploy-dir] [health-url]}
DEPLOY_DIR=${2:-${GODMODE_DEPLOY_DIR:-/opt/godmode/deploy}}
HEALTH_URL=${3:-${GODMODE_HEALTH_URL:-http://127.0.0.1:8080/api/health}}
ENV_FILE=${GODMODE_ENV_FILE:-.env.production}

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

if [ -x ./scripts/prune-old-images.sh ]; then
  ./scripts/prune-old-images.sh --previous "${PRIOR:-}" || true
elif [ -x ../scripts/prune-old-images.sh ]; then
  ../scripts/prune-old-images.sh --previous "${PRIOR:-}" || true
fi

code=$(curl -sS -o /tmp/godmode-saas-health.json -w '%{http_code}' "$HEALTH_URL" || true)
printf '%s\n' "Health HTTP ${code} (${HEALTH_URL})"
if [ "$code" != "200" ]; then
  printf '%s\n' "Health check failed" >&2
  exit 1
fi

printf '%s\n' "Pin and roll OK"
