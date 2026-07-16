param(
  [Parameter(Mandatory = $true)][string]$ReleaseUrl,
  [Parameter(Mandatory = $true)][string]$ComposeFile,
  [Parameter(Mandatory = $true)][string]$SnapshotRoot,
  [string]$ReadinessUrl = "http://127.0.0.1:8080/api/update/readiness",
  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
if (-not $env:UPDATE_READINESS_TOKEN) {
  throw "UPDATE_READINESS_TOKEN is required for deep readiness"
}
$issuer = if ($env:COSIGN_OIDC_ISSUER) {
  $env:COSIGN_OIDC_ISSUER
} else {
  "https://token.actions.githubusercontent.com"
}
$identity = if ($env:COSIGN_CERTIFICATE_IDENTITY_REGEXP) {
  $env:COSIGN_CERTIFICATE_IDENTITY_REGEXP
} else {
  "^https://github\.com/ReBoticsAI/GodMode/\.github/workflows/release\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+)$"
}
# Accept either a release directory URL or a full release-manifest.json URL.
$manifestUrl = if ($ReleaseUrl -match '/release-manifest\.json$') {
  $ReleaseUrl
} elseif ($ReleaseUrl.EndsWith('/')) {
  "$ReleaseUrl" + "release-manifest.json"
} else {
  "$ReleaseUrl/release-manifest.json"
}
$bundleUrl = "$manifestUrl.bundle"
$work = Join-Path ([IO.Path]::GetTempPath()) ("godmode-update-" + [guid]::NewGuid())
$snapshot = Join-Path $SnapshotRoot (Get-Date -AsUTC -Format "yyyyMMddTHHmmssZ")
New-Item -ItemType Directory -Force -Path $work, $snapshot | Out-Null
$committed = $false
$oldImage = ""

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $base = @()
  if ($EnvFile) { $base += @("--env-file", $EnvFile) }
  $base += @("-f", $ComposeFile)
  & docker compose @base @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed: $($Arguments -join ' ')"
  }
}

try {
  Invoke-WebRequest $manifestUrl -OutFile "$work/release-manifest.json"
  Invoke-WebRequest $bundleUrl -OutFile "$work/release-manifest.json.bundle"
  & cosign verify-blob --bundle "$work/release-manifest.json.bundle" `
    --certificate-oidc-issuer $issuer `
    --certificate-identity-regexp $identity `
    "$work/release-manifest.json"
  if ($LASTEXITCODE -ne 0) { throw "Manifest signature verification failed" }
  & node "$PSScriptRoot/../release/verify-release.mjs" "$work/release-manifest.json" $work --manifest-only
  if ($LASTEXITCODE -ne 0) { throw "Release manifest validation failed" }

  $image = & node -e "const m=require(process.argv[1]); process.stdout.write(m.image.repository+'@'+m.image.digest)" "$work/release-manifest.json"
  & cosign verify --certificate-oidc-issuer $issuer `
    --certificate-identity-regexp $identity $image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Image signature verification failed" }

  $container = (Invoke-Compose ps -q | Select-Object -First 1)
  if (-not $container) { throw "No running GodMode container exists; use the first-install procedure" }
  $oldImage = (& docker inspect --format "{{.Config.Image}}" $container).Trim()
  Invoke-Compose stop
  & docker run --rm --entrypoint sh --volumes-from $container `
    -v "${snapshot}:/snapshot" $oldImage -c @'
set -eu
for name in data plugins; do
  target="/$name"
  if [ -d "$target" ]; then
    tar -czf "/snapshot/$name.tar.gz" -C "$target" .
  fi
done
'@
  if ($LASTEXITCODE -ne 0) { throw "Snapshot creation failed" }
  Get-ChildItem $snapshot -Filter "*.tar.gz" |
    Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash.ToLower())  $([IO.Path]::GetFileName($_.Path))" } |
    Set-Content -Encoding ascii (Join-Path $snapshot "SHA256SUMS")

  $env:GODMODE_IMAGE = $image
  Invoke-Compose pull
  Invoke-Compose up -d --remove-orphans
  $headers = @{ Authorization = "Bearer $($env:UPDATE_READINESS_TOKEN)" }
  foreach ($attempt in 1..60) {
    try {
      $ready = Invoke-RestMethod -Uri $ReadinessUrl -Headers $headers -TimeoutSec 5
      if ($ready.ok) {
        $committed = $true
        Write-Output "Updated GodMode to $image; snapshot retained at $snapshot"
        break
      }
    } catch {
      # Continue bounded readiness polling.
    }
    Start-Sleep -Seconds 2
  }
  if (-not $committed) { throw "Updated container did not become ready" }
} finally {
  if (-not $committed -and $oldImage) {
    Write-Warning "Update failed; restoring prior runtime and snapshot"
    try { Invoke-Compose stop } catch {}
    $container = (Invoke-Compose ps -a -q | Select-Object -First 1)
    if ($container) {
      & docker run --rm --entrypoint sh --volumes-from $container `
        -v "${snapshot}:/snapshot:ro" $oldImage -c @'
set -eu
for name in data plugins; do
  archive="/snapshot/$name.tar.gz"
  target="/$name"
  if [ -f "$archive" ] && [ -d "$target" ]; then
    find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar -xzf "$archive" -C "$target"
  fi
done
'@
    }
    $env:GODMODE_IMAGE = $oldImage
    try { Invoke-Compose up -d --remove-orphans } catch {}
  }
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
