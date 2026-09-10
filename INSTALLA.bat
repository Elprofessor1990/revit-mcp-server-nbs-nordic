@echo off
chcp 65001 >nul 2>&1
echo.
echo   ================================================================
echo     Revit MCP Plugin - Installer
echo   ================================================================
echo.
echo   Installing...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" -SourceRoot "%~dp0"
set "INSTALL_RESULT=%ERRORLEVEL%"
echo.
echo   Press any key to close.
pause >nul
exit /b %INSTALL_RESULT%
