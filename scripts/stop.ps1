# Soprano POS süreçlerini kapatır (sunucu + yazıcı köprüsü).
$ErrorActionPreference = 'SilentlyContinue'

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*soprano*' }

if (-not $procs) {
    $procs = @()
}

foreach ($p in $procs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# 2) Tepsi simgesini yöneten PowerShell süreci
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*tray.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 3) 8095 portunu dinleyen ne varsa (eski klasörden çalışan sunucu dahil) kapat
$listeners = @(Get-NetTCPConnection -LocalPort 8095 -State Listen -ErrorAction SilentlyContinue)
foreach ($c in $listeners) {
    if ($c.OwningProcess -gt 0) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

if (($procs.Count + $listeners.Count) -eq 0) {
    Write-Host "Soprano POS calismiyor."
    Start-Sleep -Seconds 2
    exit 0
}

Write-Host "Soprano POS kapatildi ($($procs.Count + $listeners.Count) islem)."
Start-Sleep -Seconds 2
