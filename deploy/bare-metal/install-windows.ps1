param(
  [string]$InstallRoot = "$env:ProgramFiles\GodMode",
  [string]$DataDir = "$env:ProgramData\GodMode",
  [string]$SnapshotRoot = "$env:ProgramData\GodMode Backups",
  [string]$ReadinessUrl = "http://127.0.0.1:8080/api/update/readiness"
)

$ErrorActionPreference = "Stop"
if (-not $env:UPDATE_READINESS_TOKEN) {
  throw "UPDATE_READINESS_TOKEN is required"
}
$source = $PSScriptRoot
$release = Get-Content (Join-Path $source "release.json") -Raw | ConvertFrom-Json
if ($release.version -notmatch '^v\d+\.\d+\.\d+(?:-nightly\..+)?$') {
  throw "Invalid release identity: $($release.version)"
}
$target = Join-Path $InstallRoot "releases\$($release.version)"
$snapshot = Join-Path $SnapshotRoot ((Get-Date -AsUTC -Format "yyyyMMddTHHmmssZ") + "-$($release.version)")
$current = Join-Path $InstallRoot "current"
$previousTarget = if (Test-Path $current) {
  (Get-Item $current).Target
} else {
  $null
}
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "releases"), $DataDir, $snapshot | Out-Null

$service = Get-Service -Name GodMode -ErrorAction SilentlyContinue
if ($service) { Stop-Service GodMode -Force }
$archive = Join-Path $snapshot "data.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory(
  $DataDir,
  $archive,
  [IO.Compression.CompressionLevel]::Optimal,
  $false
)
(Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() + "  data.zip" |
  Set-Content -Encoding ascii (Join-Path $snapshot "SHA256SUMS")

Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $source "*") $target -Recurse -Force
$next = Join-Path $InstallRoot "current.next"
Remove-Item -Force $next -ErrorAction SilentlyContinue
New-Item -ItemType Junction -Path $next -Target $target | Out-Null
Remove-Item -Force $current -ErrorAction SilentlyContinue
Rename-Item $next "current"
if ($previousTarget) {
  $previous = Join-Path $InstallRoot "previous"
  Remove-Item -Force $previous -ErrorAction SilentlyContinue
  New-Item -ItemType Junction -Path $previous -Target $previousTarget | Out-Null
}

[Environment]::SetEnvironmentVariable("PLATFORM_DATA_DIR", $DataDir, "Machine")
[Environment]::SetEnvironmentVariable("INSTALLATION_SURFACE", "windows_bare_metal", "Machine")
[Environment]::SetEnvironmentVariable("GODMODE_VERSION", $release.version, "Machine")
[Environment]::SetEnvironmentVariable("GODMODE_COMMIT", $release.commit, "Machine")
[Environment]::SetEnvironmentVariable("UPDATE_READINESS_TOKEN", $env:UPDATE_READINESS_TOKEN, "Machine")

if (-not $service) {
  $command = "`"$current\bin\GodModeService.exe`""
  & sc.exe create GodMode "binPath= $command" start= auto | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to create GodMode service" }
}
if ($env:UPDATE_SUPERVISOR_TOKEN) {
  [Environment]::SetEnvironmentVariable(
    "UPDATE_SUPERVISOR_TOKEN",
    $env:UPDATE_SUPERVISOR_TOKEN,
    "Machine"
  )
  [Environment]::SetEnvironmentVariable(
    "UPDATE_SUPERVISOR_URL",
    "http://127.0.0.1:8791",
    "Machine"
  )
  if ($env:UPDATE_RELEASE_REPOSITORY) {
    [Environment]::SetEnvironmentVariable(
      "UPDATE_RELEASE_REPOSITORY",
      $env:UPDATE_RELEASE_REPOSITORY,
      "Machine"
    )
  }
  $supervisor = "`"$current\bin\node.exe`" `"$current\update\supervisor.mjs`""
  & schtasks.exe /Create /TN GodModeUpdateSupervisor /SC ONSTART /RU SYSTEM `
    /RL HIGHEST /TR $supervisor /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to install update supervisor task" }
  & schtasks.exe /Run /TN GodModeUpdateSupervisor | Out-Null
}
Start-Service GodMode
$headers = @{ Authorization = "Bearer $($env:UPDATE_READINESS_TOKEN)" }
foreach ($attempt in 1..60) {
  try {
    $ready = Invoke-RestMethod -Uri $ReadinessUrl -Headers $headers -TimeoutSec 5
    if ($ready.ok) {
      Write-Output "Installed GodMode $($release.version); snapshot retained at $snapshot"
      exit 0
    }
  } catch {
    # Continue bounded readiness polling.
  }
  Start-Sleep -Seconds 2
}

Stop-Service GodMode -Force -ErrorAction SilentlyContinue
if ($previousTarget) {
  Remove-Item -Force $current -ErrorAction SilentlyContinue
  New-Item -ItemType Junction -Path $current -Target $previousTarget | Out-Null
}
Remove-Item (Join-Path $DataDir "*") -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $archive -DestinationPath $DataDir -Force
if ($previousTarget) {
  Start-Service GodMode -ErrorAction SilentlyContinue
}
throw "Readiness failed; restored the previous runtime and data snapshot"
