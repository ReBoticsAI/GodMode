#!/usr/bin/env bash
# Start (or recreate) the Layer 4 build supervisor against the SaaS data volume.
# Run from the host deploy tree after .env.production has CODING_BUILD_* set.
#
#   sudo /opt/godmode/deploy/scripts/start-build-supervisor.sh
#
# Does not mount docker.sock into Bridge. Does not delete the godmode-data volume.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SUPERVISOR_DIR="${DEPLOY_DIR}/build-supervisor"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env.production}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-godmode-build}"
VOLUME_NAME="${GODMODE_DATA_VOLUME:-deploy_godmode-data}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy deploy/.env.production.example and set Layer 4 vars." >&2
  exit 1
fi

if [[ ! -f "${SUPERVISOR_DIR}/docker-compose.yml" ]]; then
  echo "Missing ${SUPERVISOR_DIR}/docker-compose.yml" >&2
  exit 1
fi

read_env() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 || true)"
  if [[ -z "${line}" ]]; then
    echo ""
    return
  fi
  printf '%s' "${line#*=}" | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

TOKEN="$(read_env CODING_BUILD_SUPERVISOR_TOKEN)"
if [[ -z "${TOKEN}" ]]; then
  echo "CODING_BUILD_SUPERVISOR_TOKEN is empty in ${ENV_FILE}." >&2
  echo "Generate one (openssl rand -hex 32), set it in .env.production, then re-run." >&2
  exit 1
fi

MODE="$(read_env CODING_BUILD_MODE)"
if [[ "${MODE}" != "ephemeral" ]]; then
  echo "CODING_BUILD_MODE must be ephemeral in ${ENV_FILE} (got: '${MODE:-unset}')." >&2
  exit 1
fi

BUILD_NET="$(read_env CODING_BUILD_NET)"
BUILD_NET="${BUILD_NET:-allowlist}"
EGRESS_HOSTS="$(read_env CODING_BUILD_EGRESS_HOSTS)"
BUILD_IMAGE="$(read_env CODING_BUILD_IMAGE)"
BUILD_IMAGE="${BUILD_IMAGE:-node:22-bookworm-slim}"

if [[ -z "${GODMODE_DATA_DIR:-}" ]]; then
  if ! docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
    echo "Docker volume ${VOLUME_NAME} not found. Set GODMODE_DATA_DIR explicitly." >&2
    exit 1
  fi
  GODMODE_DATA_DIR="$(docker volume inspect "${VOLUME_NAME}" --format '{{.Mountpoint}}')"
fi

if [[ ! -d "${GODMODE_DATA_DIR}" ]]; then
  echo "GODMODE_DATA_DIR does not exist: ${GODMODE_DATA_DIR}" >&2
  exit 1
fi

mkdir -p "${GODMODE_DATA_DIR}/tenant-workspaces"

export CODING_BUILD_SUPERVISOR_TOKEN="${TOKEN}"
export GODMODE_DATA_DIR
export PLATFORM_DATA_DIR="${GODMODE_DATA_DIR}"
export CODING_BUILD_NET="${BUILD_NET}"
export CODING_BUILD_IMAGE="${BUILD_IMAGE}"
if [[ -n "${EGRESS_HOSTS}" ]]; then
  export CODING_BUILD_EGRESS_HOSTS="${EGRESS_HOSTS}"
fi

echo "Starting build supervisor (project=${COMPOSE_PROJECT} data=${GODMODE_DATA_DIR} net=${BUILD_NET})"
cd "${SUPERVISOR_DIR}"
# Interpolation uses exported shell env (token never written to a compose .env file here).
docker compose -p "${COMPOSE_PROJECT}" -f docker-compose.yml up -d --build

echo "Waiting for /health..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:8792/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:8792/health"
    echo
    echo "Build supervisor is up. Recreate Bridge if CODING_BUILD_* env changed:"
    echo "  cd ${DEPLOY_DIR} && docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.override.yml up -d"
    exit 0
  fi
  sleep 1
done

echo "Supervisor did not become healthy on :8792" >&2
docker compose -p "${COMPOSE_PROJECT}" -f docker-compose.yml logs --tail 80 >&2 || true
exit 1
