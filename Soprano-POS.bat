@echo off
chcp 65001 >nul
title Soprano POS

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
echo   Soprano POS
echo ============================================
echo.

if not exist node_modules (
  echo Ilk kurulum: paketler yukleniyor, 1-2 dakika...
  call npm install --no-audit --no-fund
)

if not exist dist (
  echo Arayuz derleniyor...
  call npm run build
)

echo Sunucu baslatiliyor... tarayici 6 saniye icinde acilacak.
echo.
echo   ADRES : http://localhost:8095
echo   PIN   : 1234 (yonetici)  /  1111 (garson)  /  2222 (kasiyer)
echo.
echo   BU PENCEREYI KAPATMAYIN - kapatirsaniz kasa durur.
echo   Kapatmak icin: Ctrl+C, sonra bu pencereyi kapat.
echo ============================================
echo.

rem Zaten calisiyorsa ikinci kez basma
netstat -ano | findstr ":8095" | findstr LISTENING >nul
if not errorlevel 1 (
  echo Soprano zaten calisiyor: http://localhost:8095
  echo Kapatmak icin masaustundeki "Soprano Kapat" kisayolunu kullanin.
  echo.
  start "" http://localhost:8095
  timeout /t 5 >nul
  exit /b 0
)

start "Soprano Yazici" /min cmd /c "npm run bridge"
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:8095"
call npm start
echo.
echo Sunucu durdu. Pencereyi kapatabilirsiniz.
pause
