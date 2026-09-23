@echo off
rem Installs Start Page for you (no administrator rights needed): gets Node.js if needed, builds the
rem Start Page app, adds Start menu and desktop shortcuts, lists it under Settings > Apps and starts it.
rem Safe to run again, for example after updating. "install.bat /uninstall" removes it again.
setlocal EnableExtensions
title Start Page setup
cd /d "%~dp0"

echo.
echo   ~/start
echo   -------
echo.

if /i "%~1"=="/uninstall" goto :uninstall

call "%~dp0scripts\prepare.cmd"
if errorlevel 1 goto :fail
echo.
call "%NODE_EXE%" "%~dp0scripts\install.js"
if errorlevel 1 goto :fail
echo.
timeout /t 10
exit /b 0

:uninstall
choice /m "  Remove Start Page from this computer"
if errorlevel 2 exit /b 0
echo.
call "%~dp0scripts\prepare.cmd" find
if errorlevel 1 (
  echo   Node.js wasn't found, so only the shortcuts and the Apps listing can be removed.
  del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Start Page.lnk" 2>nul
  del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Start Page.lnk" 2>nul
  del /q "%USERPROFILE%\Desktop\Start Page.lnk" 2>nul
  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\StartPage" /f >nul 2>&1
  goto :fail
)
call "%NODE_EXE%" "%~dp0scripts\install.js" uninstall
if errorlevel 1 goto :fail
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
