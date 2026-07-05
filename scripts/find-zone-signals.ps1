$path = Join-Path $env:APPDATA "GodMode\ipc\from_sc.txt"
Write-Output "Scanning last 20000 lines for confluence_cluster meta..."
$tail = Get-Content $path -Tail 20000
$matches = $tail | Where-Object { $_ -like "*confluence_cluster*" }
Write-Output ("matched: " + $matches.Count)
$matches | Select-Object -Last 8
Write-Output ""
Write-Output "=== quality_stars history ==="
$tail | Where-Object { $_ -like "*quality_stars*" } | Select-Object -Last 6
Write-Output ""
Write-Output "=== current playbook_zones rows ==="
Invoke-RestMethod -Uri 'http://127.0.0.1:3847/api/playbook-zones?playbookId=pb1-confluence-zone-fade' | ConvertTo-Json -Depth 4
