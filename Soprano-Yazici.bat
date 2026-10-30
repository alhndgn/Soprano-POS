@echo off
chcp 65001 >nul
title Soprano Yazici Koprusu

setlocal

set "APP=C:\dev\projeler\soprano"
cd /d "%APP%" 2>nul
if errorlevel 1 (
  echo HATA: Soprano klasoru bulunamadi: %APP%
  pause
  exit /b 1
)

rem --- Node/npm PATH'te yoksa bilinen klasorlerden bul (cift tiklamada PATH kisa olur) ---
where npm >nul 2>nul
if not errorlevel 1 goto npm_hazir
for /d %%D in ("%LOCALAPPDATA%\hermes\tools\node-*") do set "NODE_HOME=%%~fD"
for /d %%D in ("%LOCALAPPDATA%\hermes\tools\npm-*") do set "NPM_HOME=%%~fD"
if exist "%ProgramFiles%\nodejs\npm.cmd" set "NODE_HOME=%ProgramFiles%\nodejs"
if defined NODE_HOME set "PATH=%NODE_HOME%;%PATH%"
if defined NPM_HOME set "PATH=%NPM_HOME%;%PATH%"
where npm >nul 2>nul
if not errorlevel 1 goto npm_hazir
echo.
echo HATA: Node.js / npm bulunamadi.
echo Node.js kurulu degilse https://nodejs.org adresinden kurun.
echo.
pause
exit /b 1

:npm_hazir

echo ============================================
echo   Soprano Yazici Koprusu
echo ============================================
echo.
echo   Bu pencere fişleri yazicilara gonderir.
echo   Yazici secimi: Yonetim - Yazicilar
echo.
echo   BU PENCEREYI KAPATMAYIN - kapatirsaniz
echo   fis basilmaz.
echo ============================================
echo.

if not exist node_modules (
  echo Ilk kurulum: paketler yukleniyor...
  call npm install --no-audit --no-fund
)

call npm run bridge
pause
