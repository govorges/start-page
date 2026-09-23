@echo off
rem Start page, for development and setup: runs the server in this window so you can see its output.
rem Gets Node.js if needed and installs dependencies first. To install Start Page as an app (Start menu,
rem tray icon, no window), run install.bat instead. This is the Test environment: green icons,
rem "Start Page (Test)" in Task Manager, and Settings says Test.
setlocal EnableExtensions
title Start Page (Test)
cd /d "%~dp0"

echo.
echo   ~/start
echo   -------
echo.

call "%~dp0scripts\prepare.cmd" test
if errorlevel 1 goto :fail

echo.
echo   Starting the server in this window. To stop it, press Ctrl+C, close this window,
echo   or choose Exit from the Start Page icon in the taskbar tray.
echo.
"%APP_EXE%" "%~dp0launcher.js" --test --enable --open
echo.
echo   The server stopped.
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
