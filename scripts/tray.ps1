# Soprano POS - tek tık başlatıcı (sunucu + yazıcı köprüsü) ve sistem tepsisi simgesi.
# Görünür cmd penceresi açmaz; tüm çıktı var\*.log dosyalarına yazılır.

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Aynı anda ikinci bir tepsi simgesi açma
$others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*tray.ps1*' }
if ($others) {
    Start-Process 'http://localhost:8095'
    exit 0
}

# Node/npm yolu (Hermes taşınabilir kurulumu dahil)
$paths = @()
$paths += Get-ChildItem (Join-Path $env:LOCALAPPDATA 'hermes\tools') -Directory -Filter 'node-*' -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
$paths += Get-ChildItem (Join-Path $env:LOCALAPPDATA 'hermes\tools') -Directory -Filter 'npm-*' -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
if (Test-Path 'C:\Program Files\nodejs') { $paths += 'C:\Program Files\nodejs' }
if ($paths.Count -gt 0) { $env:PATH = ($paths -join ';') + ';' + $env:PATH }

$port = 8095
function Test-Port {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Server {
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "npm start > `"$root\var\server.log`" 2>&1" `
        -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

function Start-Bridge {
    $bridge = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like '*src/bridge*' }
    if ($bridge) { return }
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "npm run bridge > `"$root\var\bridge.log`" 2>&1" `
        -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

function Restart-Bridge {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -like '*src/bridge*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
    Start-Bridge
}

# Sunucu kapalıysa başlat ve hazır olmasını bekle
$started = $false
if (-not (Test-Port)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'var') | Out-Null
    Start-Server
    $started = $true
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Port) { break }
    }
}
Start-Bridge

# Tepsi simgesi
$ni = New-Object System.Windows.Forms.NotifyIcon
$iconPath = Join-Path $root 'assets\soprano.ico'
if (Test-Path $iconPath) {
    $ni.Icon = New-Object System.Drawing.Icon($iconPath)
} else {
    $ni.Icon = [System.Drawing.SystemIcons]::Application
}
$ni.Text = 'Soprano POS'
$ni.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add('Paneli aç')
$openItem.add_Click({ Start-Process 'http://localhost:8095' })

$bridgeItem = $menu.Items.Add('Yazıcı köprüsünü yeniden başlat')
$bridgeItem.add_Click({
    Restart-Bridge
    $ni.ShowBalloonTip(2000, 'Soprano POS', 'Yazıcı köprüsü yeniden başlatıldı.', [System.Windows.Forms.ToolTipIcon]::Info)
})

$logItem = $menu.Items.Add('Günlükleri aç')
$logItem.add_Click({ Start-Process notepad.exe (Join-Path $root 'var\server.log') })

$menu.Items.Add('-') | Out-Null

$exitItem = $menu.Items.Add('Durdur ve çık')
$exitItem.add_Click({
    & (Join-Path $root 'scripts\stop.ps1') | Out-Null
    $ni.Visible = $false
    $ni.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$ni.ContextMenuStrip = $menu
$ni.add_MouseDoubleClick({ Start-Process 'http://localhost:8095' })

if (Test-Port) {
    $msg = if ($started) { 'Soprano POS başlatıldı: http://localhost:8095' } else { 'Soprano POS çalışıyor: http://localhost:8095' }
    $ni.ShowBalloonTip(3000, 'Soprano POS', $msg, [System.Windows.Forms.ToolTipIcon]::Info)
} else {
    $ni.ShowBalloonTip(6000, 'Soprano POS', 'Sunucu başlatılamadı. Günlükleri aç ile var\server.log dosyasına bak.', [System.Windows.Forms.ToolTipIcon]::Error)
}

[System.Windows.Forms.Application]::Run()
