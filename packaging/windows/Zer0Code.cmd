@echo off
rem Lanzador de Zer0Code instalado. Los datos del usuario van en %APPDATA%\Zer0Code
rem para que las actualizaciones no los toquen. Con --background no abre el navegador.
setlocal
title Zer0Code
set "APPDIR=%~dp0"
set "USERDIR=%APPDATA%\Zer0Code"
if not exist "%USERDIR%" mkdir "%USERDIR%"
if not exist "%USERDIR%\.env" copy /y "%APPDIR%app\.env.example" "%USERDIR%\.env" >nul
set "ZER0CODE_DATA_DIR=%USERDIR%\data"
set "ZER0CODE_ENV_FILE=%USERDIR%\.env"
if /i not "%~1"=="--background" set "ZER0CODE_OPEN_BROWSER=1"

"%APPDIR%runtime\node.exe" "%APPDIR%app\server\index.js"
if errorlevel 1 (
  echo.
  echo Zer0Code se ha detenido con un error. Revisa el mensaje de arriba.
  pause
)
