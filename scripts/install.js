// Installs Start Page for this Windows user, or removes it (`node scripts/install.js uninstall`).
// Run through install.bat, which gets Node.js and the dependencies ready first.
//   install:   builds StartPage.exe and the tray icon program, adds Start menu and desktop shortcuts,
//              lists Start Page under Settings > Apps, and starts it.
//   uninstall: stops it and removes the shortcuts, the start-up entry and the Apps listing. This
//              folder and your settings (config.json) are left alone.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const config = require('../lib/config');
const system = require('../lib/system');
const { ensureAppExe } = require('../lib/appexe');
const { ensureTray } = require('../lib/tray');

const ROOT = config.ROOT;
const LAUNCHER = path.join(ROOT, 'launcher.js');
const ICON = path.join(ROOT, 'assets', 'start-page.ico');
const CONHOST = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe');
const APPS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\StartPage';
const { version } = require('../package.json');

const run = (file, args) => new Promise((resolve, reject) =>
  execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()))));

// Shortcut paths come from Windows (the desktop may be redirected to OneDrive).
async function shortcutPaths() {
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "[Environment]::GetFolderPath('Programs'); [Environment]::GetFolderPath('Desktop')"]);
  const [programs, desktop] = out.split(/\r?\n/);
  return { startMenu: path.join(programs, 'Start Page.lnk'), desktop: path.join(desktop, 'Start Page.lnk') };
}

// Opens Start Page with no window (see installSignin in lib/system.js for why it goes through conhost).
function makeShortcut(lnk, app) {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SP_LNK);' +
    '$s.TargetPath = $env:SP_TARGET; $s.Arguments = $env:SP_ARGS; $s.WorkingDirectory = $env:SP_DIR;' +
    '$s.IconLocation = $env:SP_ICON; $s.WindowStyle = 7; $s.Description = "Open your start page"; $s.Save()'],
  { windowsHide: true, env: { ...process.env, SP_LNK: lnk, SP_TARGET: CONHOST, SP_ARGS: `--headless "${app}" "${LAUNCHER}" --enable --open`, SP_DIR: ROOT, SP_ICON: `${ICON},0` } },
  err => (err ? reject(err) : resolve())));
}

async function ping(port) {
  return fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()).then(j => j.app === 'start-page').catch(() => false);
}

// Stops a running copy: politely through its own API, then any leftover Start Page programs.
async function stopRunning(port) {
  if (await ping(port)) {
    await fetch(`http://127.0.0.1:${port}/api/server/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    for (let i = 0; i < 20 && await ping(port); i++) await new Promise(r => setTimeout(r, 250));
  }
  // Only this folder's copies (another checkout may be running too).
  await new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-Process StartPageTray, StartPageTray-Test, StartPage, StartPage-Test -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:SP_DIR + "\\*") } | Stop-Process -Force'],
  { windowsHide: true, env: { ...process.env, SP_DIR: path.join(ROOT, 'runtime') } }, () => resolve()));
}

async function install() {
  const cfg = config.load();
  const port = cfg.server.port;
  const asService = cfg.setupComplete && cfg.server.runMode === 'service';

  console.log('  Stopping Start Page if it is running...');
  if (!asService) await stopRunning(port);

  console.log('  Preparing the Start Page programs...');
  const app = await ensureAppExe(process.execPath);
  if (path.basename(app).toLowerCase() !== 'startpage.exe') {
    // Built but blocked (Smart App Control), or couldn't be built: Node runs Start Page just the same.
    console.log('  Start Page will run as Node.js instead (see the message above). It works the same;');
    console.log('  Task Manager just lists it as "Node.js JavaScript Runtime".');
  }
  if (!await ensureTray()) console.log('  (No tray icon: see the message above. Everything else works.)');

  console.log('  Adding shortcuts to the Start menu and the desktop...');
  const lnk = await shortcutPaths();
  await makeShortcut(lnk.startMenu, app);
  await makeShortcut(lnk.desktop, app);

  // Keep the start-up entry you chose during setup pointing at this copy.
  if (cfg.setupComplete && cfg.server.runMode === 'signin') {
    const r = await system.applyRunMode('signin');
    if (!r.ok) console.log('  Couldn’t update starting at sign-in:', r.error);
  }

  console.log('  Listing Start Page under Settings > Apps...');
  const values = [
    ['DisplayName', 'REG_SZ', 'Start Page'], ['DisplayVersion', 'REG_SZ', version], ['Publisher', 'REG_SZ', 'Start Page'],
    ['DisplayIcon', 'REG_SZ', ICON], ['InstallLocation', 'REG_SZ', ROOT],
    ['UninstallString', 'REG_SZ', `"${path.join(ROOT, 'install.bat')}" /uninstall`],
    ['NoModify', 'REG_DWORD', '1'], ['NoRepair', 'REG_DWORD', '1'],
  ];
  for (const [name, type, data] of values) await run('reg.exe', ['add', APPS_KEY, '/v', name, '/t', type, '/d', data, '/f']);

  console.log('  Starting Start Page...');
  if (asService && await ping(port)) {
    // The background task keeps running: restart its server so it uses these files (after an update).
    await fetch(`http://127.0.0.1:${port}/api/server/restart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    system.openBrowser(`http://localhost:${port}`);
  }
  else spawn('explorer.exe', [lnk.startMenu], { detached: true, stdio: 'ignore' }).unref();

  console.log('');
  console.log('  Done. Start Page is in the Start menu and on the desktop, and its ~/ icon is in the');
  console.log('  taskbar tray (Windows may tuck new icons under the ^ arrow; drag it onto the taskbar to');
  console.log('  keep it visible). Right-click the icon for Settings or Exit.');
  if (!cfg.setupComplete) console.log('  Your browser is opening the setup page now.');
}

async function uninstall() {
  const cfg = config.load();
  console.log('  Stopping Start Page...');
  await stopRunning(cfg.server.port);

  console.log('  Removing start-up, shortcuts and the Apps listing...');
  const r = await system.applyRunMode('manual');
  if (!r.ok) console.log('  Couldn’t remove the start-up entry:', r.error);
  const lnk = await shortcutPaths().catch(() => ({}));
  for (const p of [lnk.startMenu, lnk.desktop]) if (p) fs.rmSync(p, { force: true });
  await run('reg.exe', ['delete', APPS_KEY, '/f']).catch(() => {});
  for (const f of ['StartPage', 'StartPage-Test', 'StartPageTray', 'StartPageTray-Test'].flatMap(n => [n + '.exe', n + '.json'])) {
    try { fs.rmSync(path.join(ROOT, 'runtime', f), { force: true }); } catch {}
  }

  console.log('');
  console.log('  Start Page is removed. This folder and your settings are still here; delete the folder');
  console.log('  to remove everything, or run install.bat to put Start Page back.');
}

if (process.platform !== 'win32') {
  console.log('  install.bat is for Windows. Elsewhere, run `npm start`.');
  process.exit(1);
}
(process.argv[2] === 'uninstall' ? uninstall() : install()).catch(e => {
  console.error('\n  Something went wrong: ' + e.message);
  process.exit(1);
});
