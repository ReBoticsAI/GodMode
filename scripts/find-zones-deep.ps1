$path = Join-Path $env:APPDATA "GodMode\ipc\from_sc.txt"
$f = Get-Item $path
Write-Output "from_sc.txt: $([math]::Round($f.Length/1MB,1)) MB, last modified $($f.LastWriteTime)"
Write-Output ""

Write-Output "--- last 200,000 lines: confluence_cluster + zone meta ---"
$tail = Get-Content $path -Tail 200000
$zoneMatches = $tail | Where-Object { $_ -like "*confluence_cluster*" -and $_ -like "*meta=*" }
$boolMatches = $tail | Where-Object { $_ -like "*confluence_cluster*" }
Write-Output "PB_SIGNAL confluence_cluster (any): $($boolMatches.Count)"
Write-Output "PB_SIGNAL confluence_cluster with meta: $($zoneMatches.Count)"
$zoneMatches | Select-Object -Last 6

Write-Output ""
Write-Output "--- pb1 PB_POSITION (latest) ---"
$tail | Where-Object { $_ -like "PB_POSITION*pb1-confluence*" } | Select-Object -Last 1

Write-Output ""
Write-Output "--- pb1 quality_stars (latest 5) ---"
$tail | Where-Object { $_ -like "*pb1-confluence*quality_stars*" } | Select-Object -Last 5
