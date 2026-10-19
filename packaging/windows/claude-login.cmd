@echo off
rem Vincula la cuenta de Claude (suscripción Pro, Max o Team) que usará ClaudeZer0
setlocal
title Vincular cuenta de Claude
"%~dp0app\node_modules\.bin\claude.cmd" auth login
echo.
"%~dp0app\node_modules\.bin\claude.cmd" auth status
echo.
echo Si ClaudeZer0 estaba abierto, cierralo y vuelve a abrirlo para que use la cuenta.
pause
