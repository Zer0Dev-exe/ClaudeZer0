@echo off
rem Lanzador de ClaudeZer0 instalado. Los datos del usuario van en %APPDATA%\ClaudeZer0
rem para que las actualizaciones no los toquen. Con --background no abre el navegador.
setlocal
title ClaudeZer0
set "APPDIR=%~dp0"
set "USERDIR=%APPDATA%\ClaudeZer0"
if not exist "%USERDIR%" mkdir "%USERDIR%"
if not exist "%USERDIR%\.env" copy /y "%APPDIR%app\.env.example" "%USERDIR%\.env" >nul
set "CLAUDEZER0_DATA_DIR=%USERDIR%\data"
set "CLAUDEZER0_ENV_FILE=%USERDIR%\.env"
if /i not "%~1"=="--background" set "CLAUDEZER0_OPEN_BROWSER=1"

"%APPDIR%runtime\node.exe" "%APPDIR%app\server\index.js"
if errorlevel 1 (
  echo.
  echo ClaudeZer0 se ha detenido con un error. Revisa el mensaje de arriba.
  pause
)
