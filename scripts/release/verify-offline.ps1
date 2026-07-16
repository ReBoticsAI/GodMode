param([string]$Directory = ".")
$ErrorActionPreference = "Stop"
$issuer = if ($env:COSIGN_OIDC_ISSUER) { $env:COSIGN_OIDC_ISSUER } else { "https://token.actions.githubusercontent.com" }
$identity = if ($env:COSIGN_CERTIFICATE_IDENTITY_REGEXP) { $env:COSIGN_CERTIFICATE_IDENTITY_REGEXP } else { "https://github.com/ReBoticsAI/GodMode/.github/workflows/release.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)" }

# Primary trust: signed release manifest + sha256 entries for each installer/bundle.
cosign verify-blob --offline --bundle "$Directory/release-manifest.json.bundle" --certificate-oidc-issuer $issuer --certificate-identity-regexp $identity "$Directory/release-manifest.json"
if ($LASTEXITCODE -ne 0) { throw "Manifest signature verification failed" }

# Optional auditor materials (from godmode-*-verification.tar.gz).
if ((Test-Path "$Directory/SHA256SUMS") -and (Test-Path "$Directory/SHA256SUMS.bundle")) {
  cosign verify-blob --offline --bundle "$Directory/SHA256SUMS.bundle" --certificate-oidc-issuer $issuer --certificate-identity-regexp $identity "$Directory/SHA256SUMS"
  if ($LASTEXITCODE -ne 0) { throw "Checksum signature verification failed" }
}

Get-ChildItem -Path $Directory -File | Where-Object {
  $_.Name -like "GodMode-*" -or ($_.Name -like "godmode-*" -and $_.Name -notlike "*-verification.tar.gz")
} | Where-Object { $_.Extension -ne ".bundle" } | ForEach-Object {
  $bundle = "$($_.FullName).bundle"
  if (Test-Path $bundle) {
    cosign verify-blob --offline --bundle $bundle --certificate-oidc-issuer $issuer --certificate-identity-regexp $identity $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Artifact signature verification failed: $($_.Name)" }
  }
}

node "$PSScriptRoot/verify-release.mjs" "$Directory/release-manifest.json" "$Directory"
if ($LASTEXITCODE -ne 0) { throw "Release content verification failed" }
