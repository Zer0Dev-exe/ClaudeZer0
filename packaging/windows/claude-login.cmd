@echo off
rem Vincula la cuenta de Claude (suscripción Pro, Max o Team) que usará Zer0Code
setlocal
title Vincular cuenta de Claude
"%~dp0app\node_modules\.bin\claude.cmd" auth login
echo.
"%~dp0app\node_modules\.bin\claude.cmd" auth status
echo.
echo Si Zer0Code estaba abierto, cierralo y vuelve a abrirlo para que use la cuenta.
pause
