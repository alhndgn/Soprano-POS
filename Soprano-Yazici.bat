@echo off
chcp 65001 >nul
title Soprano Yazici Koprusu

set "APP=C:\dev\projeler\soprano"
cd /d "%APP%" 2>nul
if errorlevel 1 (
  echo HATA: Soprano klasoru bulunamadi: %APP%
  pause
  exit /b 1
)

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

npm run bridge
pause
