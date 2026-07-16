#!/bin/sh
set -eu

DIR=${1:-.}
ISSUER=${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}
IDENTITY=${COSIGN_CERTIFICATE_IDENTITY_REGEXP:-https://github.com/ReBoticsAI/GodMode/.github/workflows/release.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)}

cosign verify-blob --offline \
  --bundle "$DIR/release-manifest.json.bundle" \
  --certificate-oidc-issuer "$ISSUER" \
  --certificate-identity-regexp "$IDENTITY" \
  "$DIR/release-manifest.json"
cosign verify-blob --offline \
  --bundle "$DIR/SHA256SUMS.bundle" \
  --certificate-oidc-issuer "$ISSUER" \
  --certificate-identity-regexp "$IDENTITY" \
  "$DIR/SHA256SUMS"
for artifact in "$DIR"/godmode-*; do
  case "$artifact" in
    *.bundle) continue ;;
  esac
  cosign verify-blob --offline \
    --bundle "$artifact.bundle" \
    --certificate-oidc-issuer "$ISSUER" \
    --certificate-identity-regexp "$IDENTITY" \
    "$artifact"
done
node "$(dirname "$0")/verify-release.mjs" "$DIR/release-manifest.json" "$DIR"
