@echo off
chcp 65001 >nul
title Soprano POS - Kurulum
setlocal

set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
cd /d "%APP%" 2>nul
if errorlevel 1 (
  echo HATA: Klasor bulunamadi: %APP%
  pause
  exit /b 1
)

echo ============================================
echo   Soprano POS - Ilk kurulum
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("%LOCALAPPDATA%\hermes\tools\node-*") do set "NODE_HOME=%%~fD"
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_HOME=%ProgramFiles%\nodejs"
  if defined NODE_HOME set "PATH=%NODE_HOME%;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 (
  echo HATA: Node.js bulunamadi.
  echo.
  echo 1^) https://nodejs.org adresinden LTS surumu indir
  echo 2^) Kurulumu tamamla, bu pencereyi kapat
  echo 3^) Kur.bat dosyasini tekrar calistir
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo Node.js: %%v
echo.

echo [1/2] Paketler yukleniyor... (ilk seferde 1-3 dakika)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo HATA: npm install basarisiz. Internet baglantisini kontrol et.
  pause
  exit /b 1
)

echo.
echo [2/2] Arayuz derleniyor...
call npm run build
if errorlevel 1 (
  echo.
  echo HATA: Derleme basarisiz.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   KURULUM TAMAM
echo ============================================
echo.
echo   Baslatmak icin: Soprano POS.bat
echo   Kapatmak icin : Soprano Kapat.bat
echo.
echo   Ilk acilista demo menu ve personel otomatik olusur.
echo   PIN: 1234 yonetici / 1111 garson / 2222 kasiyer
echo.
pause
