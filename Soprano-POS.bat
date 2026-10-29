@echo off
chcp 65001 >nul
title Soprano POS

set "APP=C:\dev\projeler\soprano"
cd /d "%APP%" 2>nul
if errorlevel 1 (
  echo HATA: Soprano klasoru bulunamadi: %APP%
  pause
  exit /b 1
)

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

start "Soprano Yazici" /min cmd /c "npm run bridge"
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:8095"
npm start
pause
