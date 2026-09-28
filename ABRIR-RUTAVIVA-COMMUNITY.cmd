@echo off
setlocal
cd /d "%~dp0"
node --env-file-if-exists=.env iniciar.cjs
set "RUTAVIVA_EXIT=%ERRORLEVEL%"
if not "%RUTAVIVA_EXIT%"=="0" pause
exit /b %RUTAVIVA_EXIT%
