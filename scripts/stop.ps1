# Soprano POS süreçlerini kapatır (sunucu + yazıcı köprüsü).
$ErrorActionPreference = 'SilentlyContinue'

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*soprano*' }

if (-not $procs) {
    Write-Host "Soprano POS calismiyor."
    Start-Sleep -Seconds 2
    exit 0
}

foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Soprano POS kapatildi ($($procs.Count) islem)."
Start-Sleep -Seconds 2
