#!/bin/sh
set -eu

RELEASE_URL=${1:?Usage: godmode-update.sh <release-url> <compose-file> <snapshot-root> [health-url] [env-file]}
COMPOSE_FILE=${2:?Usage: godmode-update.sh <release-url> <compose-file> <snapshot-root> [health-url] [env-file]}
SNAPSHOT_ROOT=${3:?Snapshot root outside the active data volume is required}
HEALTH_URL=${4:-http://127.0.0.1:8080/api/update/readiness}
ENV_FILE=${5:-}
: "${UPDATE_READINESS_TOKEN:?UPDATE_READINESS_TOKEN is required for deep readiness}"
ISSUER=${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}
IDENTITY=${COSIGN_CERTIFICATE_IDENTITY_REGEXP:-^https://github\.com/ReBoticsAI/GodMode/\.github/workflows/release\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$}
WORK=$(mktemp -d)
SNAPSHOT="$SNAPSHOT_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$SNAPSHOT"
committed=0
old_image=
container=

# Accept either a release directory URL or a full release-manifest.json URL.
case "$RELEASE_URL" in
  */release-manifest.json)
    MANIFEST_URL="$RELEASE_URL"
    RELEASE_BASE_URL=${RELEASE_URL%/release-manifest.json}
    ;;
  */)
    MANIFEST_URL="${RELEASE_URL}release-manifest.json"
    RELEASE_BASE_URL=${RELEASE_URL%/}
    ;;
  *)
    MANIFEST_URL="${RELEASE_URL%/}/release-manifest.json"
    RELEASE_BASE_URL=${RELEASE_URL%/}
    ;;
esac
BUNDLE_URL="${MANIFEST_URL}.bundle"

compose() {
  if [ -n "$ENV_FILE" ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}
restore_snapshot() {
  [ "$committed" -eq 0 ] || return 0
  [ -n "$old_image" ] || return 0
  printf '%s\n' "Update failed; restoring prior runtime and snapshot" >&2
  compose stop || true
  container=$(compose ps -a -q | awk 'NR==1 { print; exit }')
  if [ -n "$container" ]; then
    docker run --rm --entrypoint sh --volumes-from "$container" \
      -v "$SNAPSHOT:/snapshot:ro" "$old_image" -c '
        set -eu
        for name in data plugins; do
          archive="/snapshot/$name.tar.gz"
          target="/$name"
          if [ -f "$archive" ] && [ -d "$target" ]; then
            find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
            tar -xzf "$archive" -C "$target"
          fi
        done
      ' || true
  fi
  GODMODE_IMAGE="$old_image" compose up -d --remove-orphans || true
}
cleanup() {
  restore_snapshot
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

curl --fail --location --silent --show-error "$MANIFEST_URL" -o "$WORK/release-manifest.json"
curl --fail --location --silent --show-error "$BUNDLE_URL" -o "$WORK/release-manifest.json.bundle"
cosign verify-blob \
  --bundle "$WORK/release-manifest.json.bundle" \
  --certificate-oidc-issuer "$ISSUER" \
  --certificate-identity-regexp "$IDENTITY" \
  "$WORK/release-manifest.json"
node "$(dirname "$0")/../release/verify-release.mjs" "$WORK/release-manifest.json" "$WORK" --manifest-only

IMAGE=$(node -e 'const m=require(process.argv[1]); process.stdout.write(`${m.image.repository}@${m.image.digest}`)' "$WORK/release-manifest.json")
cosign verify \
  --certificate-oidc-issuer "$ISSUER" \
  --certificate-identity-regexp "$IDENTITY" \
  "$IMAGE" >/dev/null

export GODMODE_IMAGE=$IMAGE
container=$(compose ps -q | awk 'NR==1 { print; exit }')
if [ -z "$container" ]; then
  printf '%s\n' "No running GodMode container exists; use the first-install procedure" >&2
  exit 1
fi
old_image=$(docker inspect --format '{{.Config.Image}}' "$container")
compose stop
docker run --rm --entrypoint sh --volumes-from "$container" \
  -v "$SNAPSHOT:/snapshot" "$old_image" -c '
    set -eu
    for name in data plugins; do
      target="/$name"
      if [ -d "$target" ]; then
        tar -czf "/snapshot/$name.tar.gz" -C "$target" .
      fi
    done
  '
(cd "$SNAPSHOT" && sha256sum ./*.tar.gz > SHA256SUMS)

compose pull
compose up -d --remove-orphans
attempt=1
while [ "$attempt" -le 60 ]; do
  if curl --fail --silent \
    -H "Authorization: Bearer $UPDATE_READINESS_TOKEN" \
    "$HEALTH_URL" >/dev/null; then
    committed=1
    printf 'Updated GodMode to %s; snapshot retained at %s\n' "$IMAGE" "$SNAPSHOT"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done
printf '%s\n' "Updated container did not become ready" >&2
exit 1
