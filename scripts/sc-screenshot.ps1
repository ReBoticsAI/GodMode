# Sierra Chart screenshot helper.
#   Captures the foreground SierraChart_64 main window (or a specific window
#   matched by -TitleLike) to a PNG file. If a window is provided that is not
#   the foreground, it is brought forward briefly so the contents render.
#
# Usage:
#   pwsh -File scripts/sc-screenshot.ps1
#   pwsh -File scripts/sc-screenshot.ps1 -OutPath out.png -TitleLike "Chart #2"

param(
  [string] $OutPath = "",
  [string] $TitleLike = "Sierra Chart",
  [switch] $NoBringToFront
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$signature = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'Win32').Type) {
  Add-Type -TypeDefinition $signature
}

$proc = Get-Process | Where-Object {
  $_.MainWindowTitle -like "*$TitleLike*" -and $_.ProcessName -like "SierraChart*"
} | Select-Object -First 1

if (-not $proc) {
  $proc = Get-Process -Name "SierraChart_64" -ErrorAction SilentlyContinue | Select-Object -First 1
}

if (-not $proc) {
  Write-Error "SierraChart_64 process not found"
  exit 2
}

$hWnd = $proc.MainWindowHandle
if ($hWnd -eq [IntPtr]::Zero) {
  Write-Error "Sierra Chart has no main window handle"
  exit 3
}

if (-not $NoBringToFront) {
  if ([Win32]::IsIconic($hWnd)) { [Win32]::ShowWindow($hWnd, 9) | Out-Null }
  [Win32]::BringWindowToTop($hWnd) | Out-Null
  [Win32]::SetForegroundWindow($hWnd) | Out-Null
  Start-Sleep -Milliseconds 600
}

$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) {
  Write-Error "Invalid window rect: $($rect.Left),$($rect.Top) - $($rect.Right),$($rect.Bottom)"
  exit 4
}

if ([string]::IsNullOrWhiteSpace($OutPath)) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $dir = Join-Path $PSScriptRoot "..\.screenshots"
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $OutPath = Join-Path $dir "sc-$stamp.png"
}

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($w, $h))
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

[pscustomobject]@{
  Path = (Resolve-Path $OutPath).Path
  Width = $w
  Height = $h
  Title = $proc.MainWindowTitle
  Pid = $proc.Id
} | ConvertTo-Json
