@echo off
cd /d "%~dp0"
call npm run dist
echo.
echo Installer EXE is in the dist folder (name includes version).
pause
