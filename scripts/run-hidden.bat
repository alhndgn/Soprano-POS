@echo off
rem Soprano POS - sunucu/kopru surecini gizli ve bagimsiz baslatir.
rem Kullanim: run-hidden.bat server | run-hidden.bat bridge
setlocal
set "APP=%~dp0.."
cd /d "%APP%"

set "NODE_DIR="
set "NPM="
if exist "%ProgramFiles%\nodejs\npm.cmd" (
  set "NPM=%ProgramFiles%\nodejs\npm.cmd"
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
if not defined NPM for /d %%D in ("%LOCALAPPDATA%\hermes\tools\node-*") do (
  if exist "%%~fD\npm.cmd" (
    set "NPM=%%~fD\npm.cmd"
    set "PATH=%%~fD;%PATH%"
  )
)
if not defined NPM for /d %%D in ("%LOCALAPPDATA%\hermes\tools\npm-*") do (
  set "NPM=%%~fD\npm.cmd"
)
if not defined NPM for /d %%D in ("%LOCALAPPDATA%\hermes\tools\node-*") do (
  set "NODE_DIR=%%~fD"
)

if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"
if not defined NPM (
  echo [%date% %time%] npm bulunamadi >> var\launcher.log
  exit /b 1
)

if /i "%~1"=="bridge" (
  "%NPM%" run bridge >> var\bridge.log 2>&1
) else (
  "%NPM%" start >> var\server.log 2>&1
)
