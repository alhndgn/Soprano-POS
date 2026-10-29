@echo off
chcp 65001 >nul
title Soprano POS - Kapat

set "APP=C:\dev\projeler\soprano"
cd /d "%APP%" 2>nul
if errorlevel 1 (
  echo HATA: Soprano klasoru bulunamadi: %APP%
  pause
  exit /b 1
)

echo ============================================
echo   Soprano POS kapatiliyor
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%APP%\scripts\stop.ps1"

echo.
echo   Sunucu ve yazici koprusu durduruldu.
echo   Yeniden acmak icin: Soprano POS
echo ============================================
timeout /t 3 >nul
