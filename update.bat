@echo off
rem Updates Start Page to the latest version on GitHub, then rebuilds and starts it again with install.bat.
rem Settings > Status > Updates runs this for you ("Update now"); you can also double-click it.
rem Git clones are updated with git pull; ZIP downloads get the latest ZIP. Your settings are kept.
rem "update.bat /test" is for the test copy: it starts start.bat again instead of running install.bat.
setlocal EnableExtensions

rem Updating replaces this file, and Windows reads a batch file while it runs, so run from a copy.
if not defined SP_UPDATE_ROOT (
  set "SP_UPDATE_ROOT=%~dp0"
  copy /y "%~f0" "%TEMP%\start-page-update.bat" >nul 2>&1 && "%TEMP%\start-page-update.bat" %*
)
cd /d "%SP_UPDATE_ROOT%"
title Start Page update

echo.
echo   Start Page update
echo   -----------------
echo.

call "%SP_UPDATE_ROOT%scripts\prepare.cmd" find
if errorlevel 1 (
  echo   Node.js wasn't found. Run install.bat to set Start Page up again.
  echo.
  pause
  exit /b 1
)

set "SP_FAILED="
"%NODE_EXE%" "%SP_UPDATE_ROOT%scripts\update.js"
if errorlevel 1 set "SP_FAILED=1"
echo.
if defined SP_FAILED (
  echo   Start Page will start again with the version you had.
  echo.
  pause
)

rem Start Page again: the new version, or the one you had if the update didn't finish.
if /i "%~1"=="/test" (
  start "Start Page (Test)" cmd /d /c ""%SP_UPDATE_ROOT%start.bat""
  exit /b 0
)
call "%SP_UPDATE_ROOT%install.bat"
