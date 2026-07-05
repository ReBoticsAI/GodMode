# Hub smoke test - run against a staging or local hub Bridge (default :3847).
# Usage: .\scripts\hub-smoke-test.ps1 [-BaseUrl http://127.0.0.1:3847]

param(
  [string]$BaseUrl = "http://127.0.0.1:3847"
)

$ErrorActionPreference = "Stop"
$failures = @()

function Test-Endpoint {
  param([string]$Name, [string]$Path, [int[]]$ExpectStatus = @(200))
  $url = "$BaseUrl$Path"
  try {
    $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    $status = [int]$res.StatusCode
    if ($ExpectStatus -notcontains $status) {
      $script:failures += "${Name}: HTTP $status (expected $($ExpectStatus -join '/'))"
      Write-Host "FAIL $Name - HTTP $status" -ForegroundColor Red
      return
    }
    Write-Host "OK   $Name - HTTP $status" -ForegroundColor Green
  } catch {
    $status = $null
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
    }
    if ($status -and ($ExpectStatus -contains $status)) {
      Write-Host "OK   $Name - HTTP $status" -ForegroundColor Green
      return
    }
    $script:failures += "${Name}: $($_.Exception.Message)"
    Write-Host "FAIL $Name - $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host "Hub smoke test - $BaseUrl" -ForegroundColor Cyan

Test-Endpoint -Name "Health" -Path "/api/health"

$deploymentMode = "unknown"
try {
  $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 10
  $deploymentMode = [string]$health.deploymentMode
  Write-Host "INFO deploymentMode=$deploymentMode" -ForegroundColor Cyan
} catch {
  $failures += "Health JSON parse: $($_.Exception.Message)"
}

Test-Endpoint -Name "Auth me" -Path "/api/auth/me" -ExpectStatus @(200, 401)

if ($deploymentMode -eq "hub") {
  Test-Endpoint -Name "Marketplace listings (auth required)" -Path "/api/marketplace/listings" -ExpectStatus @(401, 403)
  Test-Endpoint -Name "Integrations unmounted on hub" -Path "/api/integrations/calendar/status" -ExpectStatus @(404)
} else {
  Write-Host "SKIP hub-only auth/integration checks (mode=$deploymentMode)" -ForegroundColor Yellow
  Test-Endpoint -Name "Marketplace listings" -Path "/api/marketplace/listings" -ExpectStatus @(200, 401, 403)
}

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "All smoke checks passed." -ForegroundColor Green
  exit 0
}

Write-Host "$($failures.Count) check(s) failed:" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
exit 1
