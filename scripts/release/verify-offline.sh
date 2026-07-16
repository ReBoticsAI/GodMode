#!/bin/sh
set -eu

DIR=${1:-.}
ISSUER=${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}
IDENTITY=${COSIGN_CERTIFICATE_IDENTITY_REGEXP:-https://github.com/ReBoticsAI/GodMode/.github/workflows/release.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)}

# Primary trust: signed release manifest + sha256 entries for each installer/bundle.
cosign verify-blob --offline \
  --bundle "$DIR/release-manifest.json.bundle" \
  --certificate-oidc-issuer "$ISSUER" \
  --certificate-identity-regexp "$IDENTITY" \
  "$DIR/release-manifest.json"

# Optional auditor materials (from godmode-*-verification.tar.gz).
if [ -f "$DIR/SHA256SUMS" ] && [ -f "$DIR/SHA256SUMS.bundle" ]; then
  cosign verify-blob --offline \
    --bundle "$DIR/SHA256SUMS.bundle" \
    --certificate-oidc-issuer "$ISSUER" \
    --certificate-identity-regexp "$IDENTITY" \
    "$DIR/SHA256SUMS"
fi
for artifact in "$DIR"/godmode-*-desktop-* "$DIR"/godmode-*-bare-metal-*; do
  [ -f "$artifact" ] || continue
  case "$artifact" in
    *.bundle|*-verification.tar.gz|godmode-verification-*) continue ;;
  esac
  if [ -f "$artifact.bundle" ]; then
    cosign verify-blob --offline \
      --bundle "$artifact.bundle" \
      --certificate-oidc-issuer "$ISSUER" \
      --certificate-identity-regexp "$IDENTITY" \
      "$artifact"
  fi
done

node "$(dirname "$0")/verify-release.mjs" "$DIR/release-manifest.json" "$DIR"
