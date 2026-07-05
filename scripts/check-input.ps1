param([int]$Chart = 2, [string]$Prefix = "PB[pb1-confluence-zone-fade]:")
$enc = [uri]::EscapeDataString($Prefix)
$r = Invoke-RestMethod -Uri "http://127.0.0.1:3847/api/sc/study-inputs?chart=$Chart&study=$enc"
$keys = @(0, 1, 2, 3, 4, 23, 30, 31, 32, 33, 34, 99)
$rows = @()
foreach ($k in $keys) {
  $row = $r.inputs | Where-Object { $_.index -eq $k } | Select-Object -First 1
  if ($row) { $rows += $row }
}
$rows | Format-Table index, name, kind, value -AutoSize
Write-Output "(pending=$($r.pending))"
