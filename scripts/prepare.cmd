@echo off
rem Shared by start.bat and install.bat: finds Node.js 18 or newer (downloading a private copy if
rem there isn't one), installs dependencies and builds the Start Page programs in runtime\.
rem Sets NODE_EXE and APP_EXE for the caller. "call scripts\prepare.cmd find" only looks for Node.js;
rem "call scripts\prepare.cmd test" builds the test environment's programs (green icons).
for %%r in ("%~dp0..") do set "SP_ROOT=%%~fr"

rem ---- 1. Find Node.js: this folder's copy first, then one on PATH ----
set "NODE_EXE="
set "NPM_CMD="
set "APP_EXE="
if exist "%SP_ROOT%\runtime\node\node.exe" (
  set "NODE_EXE=%SP_ROOT%\runtime\node\node.exe"
  set "NPM_CMD=%SP_ROOT%\runtime\node\npm.cmd"
  goto :have_node
)

set "SYS_NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set "SYS_NODE_MAJOR=%%v"
if not defined SYS_NODE_MAJOR goto :get_node
if %SYS_NODE_MAJOR% LSS 18 (
  echo   Found Node.js %SYS_NODE_MAJOR% on this computer, but version 18 or newer is needed.
  goto :get_node
)
for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%p"
for /f "delims=" %%p in ('where npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%p"
goto :have_node

:get_node
if /i "%~1"=="find" exit /b 1
echo   Node.js isn't installed, so a private copy will be downloaded into this folder
echo   from nodejs.org. Nothing is installed system-wide.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SP_ROOT%\scripts\install-node.ps1"
if errorlevel 1 (
  echo.
  echo   Couldn't download Node.js. Check your internet connection and try again,
  echo   or install Node.js yourself from https://nodejs.org and then try again.
  exit /b 1
)
set "NODE_EXE=%SP_ROOT%\runtime\node\node.exe"
set "NPM_CMD=%SP_ROOT%\runtime\node\npm.cmd"
echo.

:have_node
for %%d in ("%NODE_EXE%") do set "PATH=%%~dpd;%PATH%"
if /i "%~1"=="find" exit /b 0
for /f "delims=" %%v in ('call "%NODE_EXE%" -v') do echo   Using Node.js %%v

rem ---- 2. Install dependencies if they're missing ----
if exist "%SP_ROOT%\node_modules\node-ical\package.json" if exist "%SP_ROOT%\node_modules\resedit\package.json" goto :have_modules
if not defined NPM_CMD (
  echo   npm wasn't found next to Node.js. Reinstall Node.js from https://nodejs.org, or delete
  echo   any old Node.js and try again so a private copy is downloaded.
  exit /b 1
)
echo   Installing dependencies (first run only)...
pushd "%SP_ROOT%"
rem npm ci installs what package-lock.json lists without rewriting it (keeps Git clones free of changes).
set "NPM_VERB=install"
if exist "%SP_ROOT%\package-lock.json" set "NPM_VERB=ci"
call "%NPM_CMD%" %NPM_VERB% --omit=dev --no-audit --no-fund --loglevel=error
set "NPM_ERR=%errorlevel%"
popd
if not "%NPM_ERR%"=="0" (
  echo.
  echo   Installing dependencies failed. Check your internet connection and try again.
  exit /b 1
)

:have_modules
rem ---- 3. Build "Start Page": a renamed copy of Node with the ~/ icon (so Task Manager shows it by
rem name) and the tray icon program ----
set "APP_EXE=%NODE_EXE%"
for /f "delims=" %%p in ('call "%NODE_EXE%" "%SP_ROOT%\scripts\app-exe.js" %~1') do set "APP_EXE=%%p"
exit /b 0
