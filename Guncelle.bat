@echo off
chcp 65001 >nul
title Soprano POS - Guncelle
setlocal

set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
cd /d "%APP%" 2>nul
if errorlevel 1 (
  echo HATA: Klasor bulunamadi: %APP%
  pause
  exit /b 1
)

rem --- Node/npm ---
where npm >nul 2>nul
if not errorlevel 1 goto npm_hazir
for /d %%D in ("%LOCALAPPDATA%\hermes\tools\node-*") do set "NODE_HOME=%%~fD"
for /d %%D in ("%LOCALAPPDATA%\hermes\tools\npm-*") do set "NPM_HOME=%%~fD"
if exist "%ProgramFiles%\nodejs\npm.cmd" set "NODE_HOME=%ProgramFiles%\nodejs"
if defined NODE_HOME set "PATH=%NODE_HOME%;%PATH%"
if defined NPM_HOME set "PATH=%NPM_HOME%;%PATH%"
:npm_hazir

where git >nul 2>nul
if errorlevel 1 (
  echo HATA: Git bulunamadi.
  echo Git kur: https://git-scm.com/download/win  ^(varsayilan ayarlarla^)
  echo Kurduktan sonra bu dosyayi tekrar calistir.
  pause
  exit /b 1
)

echo ============================================
echo   Soprano POS - Guncelleme
echo ============================================
echo.
for /f "delims=" %%v in ('git log -1 --pretty^=%%h^ %%s 2^>nul') do echo   Mevcut: %%v
echo.

if not exist ".git" (
  echo HATA: Bu klasor bir git deposu degil.
  echo.
  echo Guncelleme icin kurulumun git ile alinmis olmasi gerekir:
  echo   git clone REPO_ADRESI C:\Soprano
  echo Sonra bu dosyayi calistir.
  echo.
  pause
  exit /b 1
)

echo [1/4] Uygulama kapatiliyor...
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP%\scripts\stop.ps1"

echo.
echo [2/4] Yeni surum indiriliyor...
git fetch --all --prune
if errorlevel 1 (
  echo.
  echo HATA: Sunucuya ulasilamadi. Interneti ve depo erisimini kontrol et.
  pause
  exit /b 1
)
for /f "delims=" %%u in ('git rev-parse --abbrev-ref --symbolic-full-name @{u} 2^>nul') do set "UPSTREAM=%%u"
if not defined UPSTREAM set "UPSTREAM=origin/master"
echo   Kaynak: %UPSTREAM%
git reset --hard "%UPSTREAM%"
if errorlevel 1 (
  echo.
  echo HATA: Guncelleme uygulanamadi.
  pause
  exit /b 1
)
echo.
for /f "delims=" %%v in ('git log -1 --pretty^=%%h^ %%s 2^>nul') do echo   Yeni: %%v

echo.
echo [3/4] Paketler kontrol ediliyor...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo HATA: npm install basarisiz.
  pause
  exit /b 1
)

echo.
echo [4/4] Arayuz derleniyor...
call npm run build
if errorlevel 1 (
  echo HATA: Derleme basarisiz.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   GUNCELLEME TAMAM
echo ============================================
echo.
echo   Veriler korundu (var klasoru degismedi).
echo   Uygulama simdi baslatiliyor...
echo.

start "" wscript.exe "%APP%\Soprano.vbs"
exit /b 0
